"""ev16 분석 DB 주간 백업 (설계서 §4.11)

덤프(pg_dump -Fc) → 복원 리허설(임시 DB) → 보관 개수 정리 → 상태 확정
- ev13 보존 정리(일 03:00) 1시간 전 실행: 삭제 전 상태 보존
- 복원 확인 통과한 경우만 오래된 백업 삭제 (새 백업 불량 시 기존 보관분 유지)
- 결과: quality_result.backup·backup_restore, pipeline_run
- 외부 저장소 업로드 미구현 (같은 호스트 보관)
"""

from datetime import timedelta

import pendulum
from airflow.sdk import DAG, CronTriggerTimetable, Param, task
from airflow.sdk.exceptions import AirflowFailException
from common import backup, db, ops
from config.default_args import DEFAULT_ARGS

KST = "Asia/Seoul"
FINAL_TASKS = ["dump_db", "verify_restore", "prune_old"]

with DAG(
    dag_id="ev16_db_backup",
    description="분석 DB 주간 백업·복원 리허설",
    schedule=CronTriggerTimetable("0 2 * * 0", timezone=KST),
    start_date=pendulum.datetime(2026, 11, 10, tz=KST),
    catchup=False,
    max_active_runs=1,
    default_args={**DEFAULT_ARGS, "retries": 1, "execution_timeout": timedelta(minutes=60)},
    params={
        "keep": Param(4, type="integer", minimum=1, description="보관 개수 (주 1회 기준 4주)"),
        "restore_check": Param(True, type="boolean", description="임시 DB 복원 리허설"),
    },
    tags=["ev", "ops"],
) as dag:

    # 덤프 파일 생성
    @task
    def dump_db(**context):
        info = backup.conninfo_from_airflow(db.CONN_ID)
        ts = pendulum.instance(context["dag_run"].run_after).in_timezone(KST)
        path = backup.dump(info, backup.BACKUP_DIR, ts)
        size_mb = round(path.stat().st_size / 1024 / 1024, 1)
        ops.record_quality(context, "backup", "ok", size_mb, None, detail={"file": path.name})
        return {"file": path.name, "size_mb": size_mb}

    # 임시 DB 복원 → 목차 테이블 존재 확인
    @task
    def verify_restore(dumped, **context):
        if not context["params"]["restore_check"]:
            return {"skipped": True}
        info = backup.conninfo_from_airflow(db.CONN_ID)
        result = backup.restore_check(backup.BACKUP_DIR / dumped["file"], info)
        grade = "fatal" if result["missing"] or not result["tables"] else "ok"
        ops.record_quality(context, "backup_restore", grade, result["tables"] - len(result["missing"]),
                           result["tables"], detail={"file": dumped["file"], **result})  # fmt: skip
        if grade == "fatal":
            raise AirflowFailException(f"복원 확인 실패: 누락 {result['missing'][:10]}")
        return {k: result[k] for k in ("tables", "rows")}

    # 보관 개수 초과분 삭제
    @task
    def prune_old(**context):
        info = backup.conninfo_from_airflow(db.CONN_ID)
        return backup.prune(backup.BACKUP_DIR, info["dbname"], context["params"]["keep"])

    @task(trigger_rule="all_done")
    def record_run(**context):
        states = ops.task_states(context, FINAL_TASKS)
        failed = [t for t, s in states.items() if s in ("failed", "upstream_failed")]
        ti = context["ti"]
        dumped = ti.xcom_pull(task_ids="dump_db") or {}
        verified = ti.xcom_pull(task_ids="verify_restore") or {}
        pruned = ti.xcom_pull(task_ids="prune_old") or {}
        detail = {"dump": dumped, "restore": verified, "prune": pruned}
        if failed:
            ops.record_run(context, "failed", reason=f"실패 Task: {failed}", detail=detail)
            raise AirflowFailException(f"백업 실패: {failed}")
        check = "복원 확인 생략" if verified.get("skipped") else f"복원 확인 {verified.get('tables')}개 테이블"
        reason = f"{dumped.get('size_mb')}MB, {check}, 보관 {len(pruned.get('kept', []))}개"
        ops.record_run(context, "success", reason=reason, detail=detail)

    dumped = dump_db()
    verify_restore(dumped) >> prune_old() >> record_run()
