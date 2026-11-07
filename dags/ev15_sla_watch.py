"""ev15 게시 지연(SLA) 감시 (설계서 §4.10)

[기한 도래 SLA 선택] → [당일 완료 여부 확인] → [미달 시 Slack] → 상태 확정
- 실패 알림(on_failure_callback)과 별개: 보류·대기·미실행처럼 실패가 아닌 지연을 잡음
- 판정 원천은 ops.pipeline_run (Airflow 성공이어도 보류면 미달)
"""

import config.slack_block_builder as sb
import pendulum
from airflow.providers.slack.hooks.slack_webhook import SlackWebhookHook
from airflow.sdk import DAG, CronTriggerTimetable, task
from airflow.sdk.exceptions import AirflowFailException
from common import db, ops
from config.default_args import DEFAULT_ARGS

KST = "Asia/Seoul"

# SLA: DAG·기한(KST 시)·완료로 보는 상태
SLAS = [
    {"dag_id": "ev04_charger_daily", "deadline_hour": 6, "ok_statuses": ["success", "unchanged"]},
    {"dag_id": "ev03_mart_integration", "deadline_hour": 8,
     "ok_statuses": ["published", "republished", "skipped_unchanged"]},
]  # fmt: skip
CHECK_MINUTE = 5  # 기한 직후 확인
FINAL_TASKS = ["check_sla", "notify"]


# 기한 도래 SLA: 스케줄 실행은 이번 시각 기한만 (알림 1건), 수동 실행은 지난 기한 전부
def due_slas(hour, manual=False):
    return [s for s in SLAS if (s["deadline_hour"] <= hour if manual else s["deadline_hour"] == hour)]


with DAG(
    dag_id="ev15_sla_watch",
    description="게시·수집 기한 내 완료 여부 감시",
    schedule=CronTriggerTimetable(
        f"{CHECK_MINUTE} {','.join(str(h) for h in sorted({s['deadline_hour'] for s in SLAS}))} * * *", timezone=KST
    ),
    start_date=pendulum.datetime(2026, 11, 8, tz=KST),
    catchup=False,
    max_active_runs=1,
    default_args=DEFAULT_ARGS,
    tags=["ev", "monitor"],
) as dag:

    # 기한 도래 SLA별 당일 완료 여부
    @task
    def check_sla(**context):
        dr = context["dag_run"]
        hour = pendulum.instance(dr.run_after).in_timezone(KST).hour
        results = []
        for s in due_slas(hour, manual=dr.run_type == "manual"):
            r = db.execute_file("ev15/sla_status.sql", s, fetch=True)[0]
            ops.record_quality(
                context, "sla", "ok" if r["met"] else "warn", r["runs"], None, scope_key=s["dag_id"],
                detail={**r, "deadline_hour": s["deadline_hour"]},
            )  # fmt: skip
            results.append({**r, "deadline_hour": s["deadline_hour"]})
        return results

    # 미달 SLA만 Slack 1건
    @task
    def notify(results):
        missed = [r for r in results if not r["met"]]
        if not missed:
            return 0
        blocks = [sb.section_text("*기한 내 완료 안 됨*")]
        for r in missed:
            last = f"{r['last_status']} {r['last_reason'] or ''}" if r["runs"] else "당일 실행 없음"
            blocks.append(sb.section_text(f"• `{r['dag_id']}` 기한 {r['deadline_hour']:02d}:00 → {last}"))
        SlackWebhookHook(slack_webhook_conn_id="conn_slack_airflow_bot").send(text="SLA 미달", blocks=blocks)
        return len(missed)

    @task(trigger_rule="all_done")
    def record_run(**context):
        states = ops.task_states(context, FINAL_TASKS)
        failed = [t for t, s in states.items() if s in ("failed", "upstream_failed")]
        if failed:
            ops.record_run(context, "failed", reason=f"실패 Task: {failed}")
            raise AirflowFailException(f"SLA 확인 실패: {failed}")
        missed = context["ti"].xcom_pull(task_ids="notify") or 0
        ops.record_run(context, "success", reason=f"미달 {missed}건")

    notify(check_sla()) >> record_run()
