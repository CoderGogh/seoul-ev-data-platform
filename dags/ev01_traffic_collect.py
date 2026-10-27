"""ev01 도로소통정보 수집 (설계서 §4.1)

회차 생성 → 신선도 분기 → 대상 링크 → 묶음 계획 → [묶음 수집 × N, 동적 매핑]
→ 검증 → 격리 → 적재 → 시간대 집계 → 커버리지 → 상태 확정
- 검증 이후 단계는 "미처리 회차 전체"를 처리 (임시 수집기·실패 회차 자동 흡수)
- 부분 실패(일부 묶음)는 partial, 적재·집계·커버리지 실패는 DAG 실패
"""

from contextlib import closing
from datetime import datetime, timedelta, timezone

import pendulum
from airflow.sdk import DAG, CronTriggerTimetable, task
from airflow.sdk.exceptions import AirflowFailException
from common import db, ops
from common.assets import EV_TRAFFIC_OBS
from config.default_args import DEFAULT_ARGS
from hooks.seoul_openapi_hook import SeoulOpenApiHook

KST = "Asia/Seoul"
TARGET_SET = "mvp_3gu_v1"
CHUNK_SIZE = 100  # 묶음당 링크 수 → 914개 기준 10개 Task
MAX_START_DELAY = timedelta(minutes=20)  # 이보다 늦게 시작한 회차는 폐기
MAX_SPD = 150  # km/h, 초과 시 격리
API_POOL = "seoul_traffic_api_pool"

CORE_TASKS = ["load_obs", "aggregate_timeband", "record_coverage"]
FINAL_TASKS = ["init_poll_batch", "check_run_freshness", "skip_stale_run", "get_target_links", "plan_link_chunks",
               "extract_chunk", "validate_responses", "quarantine_invalid", *CORE_TASKS]  # fmt: skip


with DAG(
    dag_id="ev01_traffic_collect",
    description="실시간 도로소통정보 폴링·관측 이력·시간대 집계",
    schedule=CronTriggerTimetable("0,30 * * * *", timezone=KST),
    start_date=pendulum.datetime(2026, 10, 27, tz=KST),
    catchup=False,
    max_active_runs=1,  # 동시 실행 방지 (누적 방지는 신선도 분기)
    dagrun_timeout=timedelta(minutes=25),
    default_args=DEFAULT_ARGS,
    tags=["ev", "collect", "traffic"],
) as dag:

    # 회차 ID: run 시각에서 결정 → 재시도·Clear 해도 동일
    @task
    def init_poll_batch(**context):
        run_after = pendulum.instance(context["dag_run"].run_after).in_timezone(KST)  # SDK 는 datetime 반환
        poll_batch_id = f"ev01__{run_after:%Y%m%dT%H%M}"
        ops.record_run(context, "running", partition_key=poll_batch_id)
        return poll_batch_id

    # 지연 회차 폐기: 큐 대기·장애 복구로 늦게 시작하면 수집하지 않음
    @task.branch
    def check_run_freshness(**context):
        delay = datetime.now(timezone.utc) - context["dag_run"].run_after
        context["ti"].xcom_push(key="delay_sec", value=int(delay.total_seconds()))
        return "skip_stale_run" if delay > MAX_START_DELAY else "get_target_links"

    @task
    def skip_stale_run():
        return None

    @task
    def get_target_links():
        rows = db.execute(
            "SELECT service_link_id FROM core.target_link WHERE target_set = %s AND NOT is_excluded ORDER BY 1",
            (TARGET_SET,),
            fetch=True,
        )
        return [r["service_link_id"] for r in rows]

    # 묶음 계획을 ops 에 남김 (검증이 XCom 대신 이 기록을 기준으로 판단)
    @task
    def plan_link_chunks(poll_batch_id, links):
        chunks = [{"poll_batch_id": poll_batch_id, "chunk_no": i, "links": links[s : s + CHUNK_SIZE]}
                  for i, s in enumerate(range(0, len(links), CHUNK_SIZE))]  # fmt: skip
        with closing(db.get_conn()) as conn, conn, conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO ops.poll_chunk (poll_batch_id, chunk_no, link_cnt) VALUES (%s, %s, %s)
                   ON CONFLICT (poll_batch_id, chunk_no) DO NOTHING""",
                [(poll_batch_id, c["chunk_no"], len(c["links"])) for c in chunks],
            )
        return chunks

    # 묶음 수집: 링크 오류는 행으로 기록, 묶음 전체 실패만 Task 실패 (묶음 단위 재시도)
    @task(pool=API_POOL, queue="api", retries=3)
    def extract_chunk(chunk, **context):
        hook = SeoulOpenApiHook(api_key_var="apikey_seoul_traffic", timeout=10)
        rows = []
        for link_id in chunk["links"]:
            r = hook.call("TrafficInfo", 1, 5, link_id, raise_on_error=False)  # 링크 오류는 행으로 기록
            row = r.rows[0] if r.rows else {}
            rows.append((chunk["poll_batch_id"], link_id, context["dag_run"].run_id, chunk["chunk_no"],
                         datetime.now(timezone.utc), r.code, r.status, row.get("PRCS_SPD"), row.get("PRCS_TRV_TIME"),
                         r.resp_ms))  # fmt: skip
        if all(r[6] == "api_error" for r in rows):
            raise RuntimeError(f"묶음 {chunk['chunk_no']} 전체 실패: {rows[0][5]}")
        with closing(db.get_conn()) as conn, conn, conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO staging.traffic_raw (poll_batch_id, link_id, run_id, chunk_no, collected_at, result_code,
                       call_status, prcs_spd, prcs_trv_time, resp_ms) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (poll_batch_id, link_id) DO UPDATE SET run_id = EXCLUDED.run_id,
                       collected_at = EXCLUDED.collected_at, result_code = EXCLUDED.result_code,
                       call_status = EXCLUDED.call_status, prcs_spd = EXCLUDED.prcs_spd,
                       prcs_trv_time = EXCLUDED.prcs_trv_time, resp_ms = EXCLUDED.resp_ms""",
                rows,
            )
            cur.execute(
                "UPDATE ops.poll_chunk SET status = 'done', done_at = now() WHERE poll_batch_id = %s AND chunk_no = %s",
                (chunk["poll_batch_id"], chunk["chunk_no"]),
            )
        return {s: sum(1 for r in rows if r[6] == s) for s in ("ok", "no_data", "api_error")}

    # 검증: 일부 묶음 실패해도 성공분 진행, 처리 대상은 미처리 회차 전체
    @task(trigger_rule="all_done_min_one_success")
    def validate_responses():
        pending = db.execute_file("ev01/pending_batches.sql", fetch=True)
        return [p["poll_batch_id"] for p in pending]

    @task
    def quarantine_invalid(batch_ids, **context):
        db.execute_file("ev01/quarantine.sql", {"run_id": context["dag_run"].run_id, "batch_ids": batch_ids,
                                                "max_spd": MAX_SPD})  # fmt: skip

    @task
    def load_obs(batch_ids, **context):
        db.execute_file("ev01/load_obs.sql", {"run_id": context["dag_run"].run_id, "batch_ids": batch_ids,
                                              "max_spd": MAX_SPD})  # fmt: skip

    @task
    def aggregate_timeband(batch_ids):
        db.execute_file("ev01/aggregate_timeband.sql", {"batch_ids": batch_ids})

    # 커버리지 기록 = 회차 처리 완료 표시, 성공 시 Asset 이벤트
    @task(outlets=[EV_TRAFFIC_OBS])
    def record_coverage(batch_ids, **context):
        rows = db.execute_file(
            "ev01/record_coverage.sql",
            {"run_id": context["dag_run"].run_id, "target_set": TARGET_SET, "batch_ids": batch_ids},
            fetch=True,
        )
        return rows

    # 최종 상태 확정: 허용된 부분 실패와 핵심 실패 구분
    @task(trigger_rule="all_done")
    def finalize_run_status(**context):
        states = ops.task_states(context, FINAL_TASKS)
        ti = context["ti"]
        poll_batch_id = ti.xcom_pull(task_ids="init_poll_batch")
        if states.get("skip_stale_run") == "success":
            delay = ti.xcom_pull(task_ids="check_run_freshness", key="delay_sec")
            ops.record_run(context, "skipped_stale", poll_batch_id, reason=f"시작 지연 {delay}초")
            return
        core_failed = [t for t in CORE_TASKS if states.get(t) in ("failed", "upstream_failed")]
        if core_failed or states.get("validate_responses") in ("failed", "upstream_failed", None):
            ops.record_run(
                context, "failed", poll_batch_id, reason=f"핵심 단계 실패: {core_failed or '전체 묶음 실패'}"
            )
            raise AirflowFailException(f"핵심 처리 실패: {core_failed or '전체 묶음 실패'}")
        coverage = ti.xcom_pull(task_ids="record_coverage") or []
        cur = next((c for c in coverage if c["poll_batch_id"] == poll_batch_id), None)
        # 부분 실패: 이번 회차 미처리, API 오류, 또는 실패 묶음으로 응답 수 < 대상 수
        answered = (cur["ok_cnt"] + cur["no_data_cnt"] + cur["api_error_cnt"] + cur["invalid_cnt"]) if cur else 0
        partial = cur is None or cur["api_error_cnt"] > 0 or answered < cur["target_cnt"]
        detail = {"processed_batches": [c["poll_batch_id"] for c in coverage], "current": cur}
        ops.record_run(context, "partial" if partial else "success", poll_batch_id, detail=detail)

    poll_batch_id = init_poll_batch()
    fresh = check_run_freshness()
    stale = skip_stale_run()
    links = get_target_links()
    chunks = plan_link_chunks(poll_batch_id, links)
    extracted = extract_chunk.expand(chunk=chunks)
    batch_ids = validate_responses()
    quarantined = quarantine_invalid(batch_ids)
    loaded = load_obs(batch_ids)
    aggregated = aggregate_timeband(batch_ids)
    covered = record_coverage(batch_ids)
    final = finalize_run_status()

    poll_batch_id >> fresh >> [stale, links]
    extracted >> batch_ids >> quarantined >> loaded >> aggregated >> covered >> final
    stale >> final
