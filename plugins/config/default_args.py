# 공통 default_args: 지수 백오프 재시도, 실패 알림, 실행 시간 상한
from datetime import timedelta

from config.on_failure_callback_to_slack import on_failure_callback_to_slack

DEFAULT_ARGS = {
    "owner": "ev-platform",
    "retries": 2,
    "retry_delay": timedelta(minutes=1),
    "retry_exponential_backoff": True,
    "max_retry_delay": timedelta(minutes=10),
    "execution_timeout": timedelta(minutes=20),
    "on_failure_callback": on_failure_callback_to_slack,
}
