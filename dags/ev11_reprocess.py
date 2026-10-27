"""ev11 재처리 단일 진입점 (설계서 §4.5)

요청 검증 → 요청 등록(request_id) → 범위 분기
  registration: ev02 트리거 (ev03 는 ev02 Asset 이벤트로 이어짐, 직접 트리거 안 함)
  timeband    : 기간 시간대 재집계 → ev03 명시 트리거
  mart        : ev03 명시 트리거 (임계값·마스터 변경, 필요 시 force)
→ 요청 결과 기록 (all_done)
- 하위 DAG 는 deferrable 대기 (triggerer 가 대기, 워커 슬롯 비점유)
- 여러 월은 동적 매핑, 하위 DAG max_active_runs=1 이 직렬화
"""

import json

import pendulum
from airflow.providers.standard.operators.trigger_dagrun import TriggerDagRunOperator
from airflow.sdk import DAG, Param, task
from airflow.sdk.exceptions import AirflowFailException
from common import db, ops
from config.default_args import DEFAULT_ARGS

KST = "Asia/Seoul"
SCOPES = {"registration": "build_ev02_confs", "timeband": "reaggregate_timeband", "mart": "build_mart_confs"}
FINAL_TASKS = ["validate_request", "register_request", "route_scope", "build_ev02_confs", "trigger_ev02",
               "reaggregate_timeband", "trigger_ev03_timeband", "build_mart_confs", "trigger_ev03_mart"]  # fmt: skip

TRIGGER_ARGS = dict(
    wait_for_completion=True,
    deferrable=True,
    poke_interval=20,
    allowed_states=["success"],
    failed_states=["failed"],
)


def _ev03_conf(p, base_month, request_id, force):
    conf = {"base_month": base_month, "force": force, "request_id": request_id}
    for k in ("window_start", "window_end"):
        if p[k]:
            conf[k] = p[k]
    return conf


with DAG(
    dag_id="ev11_reprocess",
    description="재처리 요청 진입점 (범위별 단일 경로)",
    schedule=None,
    start_date=pendulum.datetime(2026, 10, 27, tz=KST),
    catchup=False,
    max_active_runs=1,
    default_args=DEFAULT_ARGS,
    params={
        "scope": Param("mart", enum=list(SCOPES), description="registration | timeband | mart"),
        "base_months": Param([], type="array", items={"type": "string", "pattern": r"^\d{6}$"}),
        "source": Param("api", enum=["api", "file"], description="registration: 원천 경로"),
        "file_name": Param(None, type=["null", "string"], description="registration·file: 파일명 (1개월)"),
        "date_from": Param(None, type=["null", "string"], format="date", description="timeband: 시작일"),
        "date_to": Param(None, type=["null", "string"], format="date", description="timeband: 종료일"),
        "window_start": Param(None, type=["null", "string"], description="ev03 분석 기간 지정 (선택)"),
        "window_end": Param(None, type=["null", "string"]),
        "force": Param(False, type="boolean", description="mart: fingerprint 비교 생략"),
        "reason": Param("", type="string", minLength=2, description="재처리 사유 (필수)"),
    },
    tags=["ev", "reprocess"],
) as dag:

    # 범위별 필수 인자 검증 (잘못된 요청은 하위 DAG 를 건드리기 전에 차단)
    @task
    def validate_request(**context):
        p = context["params"]
        if p["scope"] in ("registration", "mart") and not p["base_months"]:
            raise AirflowFailException(f"{p['scope']}: base_months 필요")
        if (
            p["scope"] == "registration"
            and p["source"] == "file"
            and (not p["file_name"] or len(p["base_months"]) != 1)
        ):
            raise AirflowFailException("registration·file: file_name 과 base_months 1개 필요")
        if p["scope"] == "timeband" and not (p["date_from"] and p["date_to"] and p["base_months"]):
            raise AirflowFailException("timeband: date_from·date_to·base_months 필요")

    @task
    def register_request(**context):
        p = context["params"]
        r = db.execute(
            """INSERT INTO ops.reprocess_request (scope, base_months, date_from, date_to, force, reason, status,
                                                  requested_by)
               VALUES (%(scope)s, %(base_months)s::char(6)[], %(date_from)s, %(date_to)s, %(force)s, %(reason)s,
                       'running', %(run_id)s)
               RETURNING request_id""",
            {**p, "run_id": context["dag_run"].run_id},
            fetch=True,
        )[0]
        ops.record_run(context, "running", partition_key=p["scope"], detail={"request_id": r["request_id"], **p})
        return r["request_id"]

    @task.branch
    def route_scope(**context):
        return SCOPES[context["params"]["scope"]]

    # registration: ev02 만 트리거 (ev03 는 Asset 으로)
    @task
    def build_ev02_confs(request_id, **context):
        p = context["params"]
        return [{"base_month": m, "source": p["source"], "file_name": p["file_name"], "request_id": request_id}
                for m in p["base_months"]]  # fmt: skip

    # timeband: 기간 내 회차의 시간대 대표값 재계산 → ev03 대상 월 목록
    @task
    def reaggregate_timeband(request_id, **context):
        p = context["params"]
        batches = db.execute(
            """SELECT DISTINCT poll_batch_id FROM core.traffic_obs
               WHERE (collected_at AT TIME ZONE 'Asia/Seoul')::date
                     BETWEEN %(date_from)s::date AND %(date_to)s::date""",
            p,
            fetch=True,
        )
        batch_ids = [b["poll_batch_id"] for b in batches]
        if batch_ids:
            db.execute_file("ev01/aggregate_timeband.sql", {"batch_ids": batch_ids})
        ops.record_quality(context, "reaggregated_batches", "ok", len(batch_ids))
        return [_ev03_conf(p, m, request_id, False) for m in p["base_months"]]

    @task
    def build_mart_confs(request_id, **context):
        p = context["params"]
        return [_ev03_conf(p, m, request_id, p["force"]) for m in p["base_months"]]

    trigger_ev02 = TriggerDagRunOperator.partial(
        task_id="trigger_ev02", trigger_dag_id="ev02_registration_monthly", **TRIGGER_ARGS
    )
    trigger_ev03_timeband = TriggerDagRunOperator.partial(
        task_id="trigger_ev03_timeband", trigger_dag_id="ev03_mart_integration", **TRIGGER_ARGS
    )
    trigger_ev03_mart = TriggerDagRunOperator.partial(
        task_id="trigger_ev03_mart", trigger_dag_id="ev03_mart_integration", **TRIGGER_ARGS
    )

    # 요청 결과 기록: 어떤 경로든 실행
    @task(trigger_rule="all_done")
    def record_request_result(**context):
        states = ops.task_states(context, FINAL_TASKS)
        request_id = context["ti"].xcom_pull(task_ids="register_request")
        failed = [t for t, s in states.items() if s in ("failed", "upstream_failed")]
        status = "failed" if failed else "done"
        if request_id:
            db.execute(
                """UPDATE ops.reprocess_request SET status = %(s)s, finished_at = now(), detail = %(d)s::jsonb
                   WHERE request_id = %(r)s""",
                {"s": status, "d": json.dumps({"task_states": states}), "r": request_id},
            )
        ops.record_run(context, "failed" if failed else "success", context["params"]["scope"],
                       reason=f"request_id={request_id}" + (f", 실패 {failed}" if failed else ""))  # fmt: skip
        if failed:
            raise AirflowFailException(f"재처리 실패: {failed}")

    validated = validate_request()
    request_id = register_request()
    route = route_scope()
    ev02_confs = build_ev02_confs(request_id)
    tb_confs = reaggregate_timeband(request_id)
    mart_confs = build_mart_confs(request_id)
    t02 = trigger_ev02.expand(conf=ev02_confs)
    t03_tb = trigger_ev03_timeband.expand(conf=tb_confs)
    t03_mart = trigger_ev03_mart.expand(conf=mart_confs)
    done = record_request_result()

    validated >> request_id >> route >> [ev02_confs, tb_confs, mart_confs]
    [t02, t03_tb, t03_mart] >> done
