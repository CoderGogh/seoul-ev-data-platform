"""ev10 마스터 갱신 (설계서 §4.4)

경계 등록 → 매핑 적재 → 표준링크 원천 분기(추출 | 재사용) → 서비스링크 형상 → 행정동 귀속
→ 품질 기록 → 품질 게이트 분기(활성 | 거부) → 수집 대상 고정 → 상태 확정
- 검증을 통과한 버전만 active, 그때만 Asset 이벤트 → ev03 트리거
- 귀속률 미달은 실행 오류가 아니라 데이터 판정 → held (DAG 성공)
- 표준링크 SHP 원본(staging.moct_link_raw)은 scripts/load_master.sh 로 수동 적재
"""

import pendulum
from airflow.providers.standard.operators.empty import EmptyOperator
from airflow.sdk import DAG, Param, task
from airflow.sdk.exceptions import AirflowFailException
from common import db, ops
from common.assets import EV_MASTER_VERSION
from config.default_args import DEFAULT_ARGS

KST = "Asia/Seoul"
FINAL_TASKS = ["register_boundary", "load_link_mapping", "check_std_source", "extract_std_link", "reuse_std_link",
               "build_service_link", "assign_admdong", "link_quality", "quality_gate", "activate_version",
               "reject_version", "build_target_link", "cleanup_raw_shp"]  # fmt: skip


def _params(context):
    p = dict(context["params"])
    p["link_ver"] = f"map{p['mapping_ver']}_shp{p['shp_ver']}"
    return p


with DAG(
    dag_id="ev10_master_refresh",
    description="링크 매핑·행정동 경계 버전 갱신과 활성화",
    schedule=None,
    start_date=pendulum.datetime(2026, 10, 1, tz=KST),
    catchup=False,
    max_active_runs=1,
    default_args=DEFAULT_ARGS,
    params={
        "boundary_ver": Param("ver20260701", type="string"),
        "boundary_file": Param("/data/master/boundary/HangJeongDong_ver20260701.geojson", type="string"),
        "mapping_ver": Param("20250306", type="string"),
        "mapping_file": Param("/data/master/link_mapping_20250306.json", type="string"),
        "shp_ver": Param("20261014", type="string"),
        "target_set": Param("mvp_3gu_v1", type="string"),
        "target_sgg": Param("강남구,서초구,송파구", type="string", description="쉼표 구분 자치구명"),
        "min_assign_rate": Param(95, type="number", description="활성화 최소 귀속률 %"),
    },
    tags=["ev", "master"],
) as dag:

    @task
    def register_boundary(**context):
        p = _params(context)
        ops.record_run(context, "running", partition_key=p["link_ver"], detail=p)
        db.execute_file("ev10/01_admdong.sql", p)

    @task
    def load_link_mapping(**context):
        db.execute_file("ev10/02_link_mapping.sql", _params(context))

    # 표준링크 원천: 원본 적재돼 있으면 추출, 같은 SHP 버전이 이미 있으면 재사용
    @task.branch
    def check_std_source(**context):
        p = _params(context)
        r = db.execute(
            """SELECT to_regclass('staging.moct_link_raw') IS NOT NULL AS has_raw,
                      EXISTS (SELECT 1 FROM core.std_link WHERE shp_ver = %(shp_ver)s) AS has_std""",
            p,
            fetch=True,
        )[0]
        if r["has_raw"]:
            return "extract_std_link"
        if r["has_std"]:
            return "reuse_std_link"
        raise AirflowFailException("표준링크 원본 없음: scripts/load_master.sh 로 SHP 적재 필요")

    @task
    def extract_std_link(**context):
        db.execute_file("ev10/03_std_link.sql", _params(context))

    reuse_std_link = EmptyOperator(task_id="reuse_std_link")

    # 분기 합류
    @task(trigger_rule="none_failed_min_one_success")
    def build_service_link(**context):
        db.execute_file("ev10/04_service_link.sql", _params(context))

    @task
    def assign_admdong(**context):
        db.execute_file("ev10/05_link_admdong.sql", _params(context))

    @task
    def link_quality(**context):
        r = db.execute_file("ev10/06_link_quality.sql", _params(context), fetch=True)[0]
        ops.record_quality(context, "assign_rate", "ok", r["assign_rate"], context["params"]["min_assign_rate"],
                           detail=r["quality"])  # fmt: skip
        return float(r["assign_rate"])

    # 품질 게이트: 기준 통과 시에만 활성화
    @task.branch
    def quality_gate(assign_rate, **context):
        return "activate_version" if assign_rate >= context["params"]["min_assign_rate"] else "reject_version"

    # 기존 활성 은퇴 + 신규 활성, 성공 시에만 Asset 이벤트
    @task(outlets=[EV_MASTER_VERSION])
    def activate_version(**context):
        p = _params(context)
        db.execute_file("ev10/07_activate.sql", p)
        context["outlet_events"][EV_MASTER_VERSION].extra = {
            "link_ver": p["link_ver"],
            "boundary_ver": p["boundary_ver"],
        }

    @task
    def reject_version(**context):
        db.execute_file("ev10/07_reject.sql", _params(context))

    # 수집 대상 고정 (커버리지 분모, 단일 트랜잭션 교체 → ev01 이 빈 목록을 읽지 않음)
    @task
    def build_target_link(**context):
        db.execute_file("ev10/08_target_link.sql", _params(context))

    # 전국 원본 정리 (다음 실행은 재사용 경로)
    @task
    def cleanup_raw_shp():
        db.execute("DROP TABLE IF EXISTS staging.moct_link_raw")

    @task(trigger_rule="all_done")
    def record_run(**context):
        states = ops.task_states(context, FINAL_TASKS)
        link_ver = _params(context)["link_ver"]
        failed = [t for t, s in states.items() if s in ("failed", "upstream_failed")]
        if failed:
            ops.record_run(context, "failed", link_ver, reason=f"실패 Task: {failed}")
            raise AirflowFailException(f"핵심 처리 실패: {failed}")
        if states.get("reject_version") == "success":
            ops.record_run(context, "held", link_ver, reason="귀속률 기준 미달: 버전 rejected, 기존 활성 유지")
        else:
            ops.record_run(context, "success", link_ver, reason="버전 활성화")

    boundary = register_boundary()
    mapping = load_link_mapping()
    source = check_std_source()
    extracted = extract_std_link()
    service = build_service_link()
    assigned = assign_admdong()
    rate = link_quality()
    gate = quality_gate(rate)
    activated = activate_version()
    rejected = reject_version()
    target = build_target_link()
    cleanup = cleanup_raw_shp()
    done = record_run()

    boundary >> mapping >> source >> [extracted, reuse_std_link] >> service >> assigned >> rate
    gate >> [activated, rejected]
    activated >> target >> cleanup >> done
    rejected >> done
