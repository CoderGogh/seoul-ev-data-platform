# Task 실패 시 Slack 알림 (default_args의 on_failure_callback)
import logging

from airflow.providers.slack.hooks.slack_webhook import SlackWebhookHook

import config.slack_block_builder as sb

SLACK_CONN_ID = 'conn_slack_airflow_bot'
ERR_MSG_MAX_LEN = 500  # Slack 블록 텍스트 길이 제한 대비

log = logging.getLogger(__name__)


def on_failure_callback_to_slack(context):
    ti = context.get('ti')
    dag_run = context.get('dag_run')
    err_msg = str(context.get('exception'))[:ERR_MSG_MAX_LEN]
    # 수동 실행은 data_interval이 없을 수 있어 run_after 기준
    run_after = dag_run.run_after.in_timezone('Asia/Seoul').strftime('%Y-%m-%d %H:%M')

    blocks = [
        sb.section_text(f"*{ti.dag_id}.{ti.task_id} 실패*"),
        sb.fields([
            f"*실행 시각*: {run_after}",
            f"*시도 횟수*: {ti.try_number}",
            f"*run_id*: {dag_run.run_id}",
        ]),
        sb.section_text(f"*에러 내용*\n```{err_msg}```"),
    ]

    # 알림 실패가 작업 결과에 영향 주지 않도록 로그만 기록
    try:
        SlackWebhookHook(slack_webhook_conn_id=SLACK_CONN_ID).send(text=f"{ti.dag_id}.{ti.task_id} 실패", blocks=blocks)
    except Exception as e:
        log.warning('Slack 알림 전송 실패: %s', e)
