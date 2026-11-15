"""ev05 수요 보조 주간 배치 (설계서 §4.12)

대상 구 결정 → [공동주택 구별 수집(동적 매핑) | 공영주차장 수집] → 격리 → 위치 판정 → 정제·동 귀속 → 품질 게이트 → 스냅샷 반영
- 공동주택: 단지 목록(국토부) → 단지별 기본 정보(세대수). 공영주차장: 서울시 안내 정보(서울 전체 → 대상 구)
- 원천에 좌표 없음(주차장 일부만) → 브이월드 지오코더로 실행 중 행정동 판정. 좌표는 약관상 저장 금지라 행정동 코드만 기록
- 원천은 현재 상태만 제공 → 수집일(KST) 스냅샷, 같은 날 재실행은 교체
- ev03 은 이 결과를 참고 지표로만 붙임 (분류 미사용)
"""

import json
from contextlib import closing

import pendulum
from airflow.sdk import DAG, CronTriggerTimetable, Param, task
from airflow.sdk.exceptions import AirflowFailException
from common import db, locate, ops
from common.assets import EV_DEMAND_AUX
from config.default_args import DEFAULT_ARGS
from hooks.data_go_kr_hook import DataGoKrHook, GoKrLimitError
from hooks.seoul_openapi_hook import SeoulOpenApiHook
from hooks.vworld_hook import VWorldGeocoderHook

KST = "Asia/Seoul"
APT_LIST_SERVICE = "1613000/AptListService4/getSigunguAptList4"
APT_BASIS_SERVICE = "1613000/AptBasisInfoServiceV5/getAphusBassInfoV5"
PARKING_SERVICE = "GetParkInfo"  # 서울시 공영주차장 안내 정보 (OA-13122)
APT_LIST_KEY_VAR = "apikey_apt_list"
APT_BASIS_KEY_VAR = "apikey_apt_basis"
PARKING_KEY_VAR = "apikey_seoul_parking"
VWORLD_KEY_VAR = "apikey_vworld"
APT_POOL = "apt_api_pool"
PARKING_POOL = "seoul_parking_api_pool"
VWORLD_POOL = "vworld_api_pool"
PAGE_SIZE = 1000
API_INTERVAL = 0.2  # 공동주택 API 호출 간격 초 (연속 호출 시 429). 간헐 오류 04는 Hook에서 재호출

# 품질 게이트 기준
MIN_APT_COLLECT = 0.95  # 원천 단지 대비 정제 단지 (미만 치명, 기본 정보 대량 실패)
MIN_APT_HH_ASSIGN = 0.90  # 세대 가중 행정동 귀속률 (미만 치명)
MIN_PARKING_ASSIGN = 0.50  # 주차장 귀속률 (미만 치명)
WARN_PARKING_ASSIGN = 0.90  # 주차장 귀속률 (미만 경고)
MAX_DROP_RATIO = 0.10  # 직전 적재 대비 단지·주차장 감소 비율 (초과 치명, 원천 일부 누락 의심)

FINAL_TASKS = ["init_run", "list_sgg", "extract_apt", "extract_parking", "quarantine_invalid", "locate_targets",
               "normalize_assign", "aux_gate", "load_snapshot"]  # fmt: skip

