# DAG 간 연결 Asset (한 곳에서만 정의)
from airflow.sdk import Asset

EV_TRAFFIC_OBS = Asset(name="ev_traffic_obs", uri="x-ev://core/traffic_obs")  # ev01 → 모니터링
EV_REG_SNAPSHOT = Asset(name="ev_reg_snapshot", uri="x-ev://core/reg_snapshot")  # ev02 → ev03
EV_MASTER_VERSION = Asset(name="ev_master_version", uri="x-ev://core/master_version")  # ev10 → ev03
EV_MART_PUBLISHED = Asset(name="ev_mart_published", uri="x-ev://mart/fact_admdong_indicator")  # ev03 → 조회
