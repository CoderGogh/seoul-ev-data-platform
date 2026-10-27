"""ev13 조건부 보존 정리 (설계서 §4.6)

삭제 후보 계산 → 리포트 기록 → 분기(dry_run: 보고만 | 실행: 단일 트랜잭션 삭제) → 상태 확정
- 기간 경과만으로 지우지 않음: 시간대 미확정·미게시·열린 재처리 요청이면 관측 이력 보호 (재처리·계보 근거)
- 원천 응답은 회차 처리 완료 후에만, 등록 원천은 실행 상태 확정 후에만 삭제
- 집계·스냅샷·게시 로그·마스터 버전은 대상 아님
- 기본 dry_run=true: 삭제하지 않고 후보와 보호 사유만 기록
"""

import pendulum
from airflow.providers.standard.operators.empty import EmptyOperator
from airflow.sdk import DAG, CronTriggerTimetable, Param, task
from airflow.sdk.exceptions import AirflowFailException
from common import db, ops
from config.default_args import DEFAULT_ARGS

KST = "Asia/Seoul"
FINAL_TASKS = ["find_candidates", "decide_delete", "skip_delete", "delete_expired"]

with DAG(
    dag_id="ev13_retention_cleanup",
    description="보존 기간 경과분 조건부 정리 (기본 dry-run)",
    schedule=CronTriggerTimetable("0 3 * * 0", timezone=KST),
    start_date=pendulum.datetime(2026, 10, 27, tz=KST),
    catchup=False,
    max_active_runs=1,
    default_args=DEFAULT_ARGS,
    params={
        "retention_days": Param(30, type="integer", minimum=0, description="보존 기간 (일)"),
        "dry_run": Param(True, type="boolean", description="true: 보고만, false: 삭제 실행"),
    },
    tags=["ev", "ops"],
) as dag:

    # 대상별 기간 경과 건수, 삭제 가능, 보호 사유별 건수
    @task
    def find_candidates(**context):
        rows = db.execute_file(
            "ev13/candidates.sql", {"retention_days": context["params"]["retention_days"]}, fetch=True
        )
        for r in rows:
            protected = r["expired"] - r["deletable"]
            ops.record_quality(context, "retention", "ok" if not protected else "warn", r["deletable"], r["expired"],
                               scope_key=r["target"], detail=r)  # fmt: skip
        return rows

    @task.branch
    def decide_delete(**context):
        return "skip_delete" if context["params"]["dry_run"] else "delete_expired"

    skip_delete = EmptyOperator(task_id="skip_delete")

    @task
    def delete_expired(**context):
        db.execute_file("ev13/delete_expired.sql", {"retention_days": context["params"]["retention_days"]})

    @task(trigger_rule="all_done")
    def record_run(**context):
        states = ops.task_states(context, FINAL_TASKS)
        failed = [t for t, s in states.items() if s in ("failed", "upstream_failed")]
        rows = context["ti"].xcom_pull(task_ids="find_candidates") or []
        mode = "dry_run" if context["params"]["dry_run"] else "delete"
        summary = {r["target"]: {"deletable": r["deletable"], "protected": r["expired"] - r["deletable"]} for r in rows}
        if failed:
            ops.record_run(context, "failed", mode, reason=f"실패 Task: {failed}", detail=summary)
            raise AirflowFailException(f"정리 실패: {failed}")
        total = sum(v["deletable"] for v in summary.values())
        verb = "삭제 가능" if mode == "dry_run" else "삭제"
        ops.record_run(context, "success", mode, reason=f"{verb} {total}건", detail=summary)

    candidates = find_candidates()
    decision = decide_delete()
    deleted = delete_expired()
    candidates >> decision >> [skip_delete, deleted]
    [skip_delete, deleted] >> record_run()
