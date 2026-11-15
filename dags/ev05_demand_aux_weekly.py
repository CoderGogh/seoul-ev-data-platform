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

INSERT_APT = """INSERT INTO staging.apt_raw (run_id, sgg_cd, row_no, list_payload, basis_payload)
                VALUES (%s, %s, %s, %s, %s)"""
INSERT_PARKING = "INSERT INTO staging.parking_raw (run_id, row_no, payload) VALUES (%s, %s, %s)"


def _info(context):
    return context["ti"].xcom_pull(task_ids="init_run")


def _dumps(v):
    return json.dumps(v, ensure_ascii=False) if v is not None else None


with DAG(
    dag_id="ev05_demand_aux_weekly",
    description="공동주택 세대수·공영주차장 주간 스냅샷 (수요 보조 지표)",
    schedule=CronTriggerTimetable("30 4 * * 1", timezone=KST),  # 월 04:30, ev04 05:00 이전
    start_date=pendulum.datetime(2026, 11, 9, tz=KST),
    catchup=False,
    max_active_runs=1,
    default_args=DEFAULT_ARGS,
    params={
        "target_set": Param("mvp_3gu_v1", type="string", description="대상 링크 세트 (대상 구 결정)"),
        "allow_mass_drop": Param(False, type="boolean", description="감소 비율 게이트 생략 (원천 정비 확인 후만)"),
    },
    tags=["ev", "collect", "demand"],
) as dag:

    # 수집일·대상 구 결정, 과거 날짜 재적재 차단
    @task
    def init_run(**context):
        p = context["params"]
        snapshot_date = pendulum.now(KST).date()
        sggs = db.execute_file("ev04/target_sgg.sql", {"target_set": p["target_set"]}, fetch=True)
        if not sggs:
            raise AirflowFailException(f"대상 구 없음: {p['target_set']}")
        last = db.execute("SELECT max(snapshot_date) AS d FROM ops.aux_load", fetch=True)[0]["d"]
        if last and snapshot_date < last:
            raise AirflowFailException(f"수집일 {snapshot_date} < 최근 적재 {last}: 과거 날짜 재적재 불가")
        info = {
            "snapshot_date": snapshot_date.isoformat(),
            "sgg_cds": [r["sgg_cd"] for r in sggs],
            "sgg_map": {r["sgg_nm"]: r["sgg_cd"] for r in sggs},
        }
        ops.record_run(context, "running", partition_key=info["snapshot_date"], detail=info)
        return info

    @task
    def list_sgg(info):
        return info["sgg_cds"]

    # 구별 단지 목록 → 단지별 기본 정보 → staging (재시도 멱등: 같은 run·구 교체)
    # 단지 하나 기본 정보 실패는 NULL 로 두고 격리 (대량 실패는 게이트 치명)
    # 호출 한도 초과는 즉시 중단, 받은 만큼 저장 → 재시도는 받은 단지 재사용 (한도 소모 방지)
    @task(pool=APT_POOL, queue="api", retries=3)
    def extract_apt(sgg_cd, **context):
        run_id = context["dag_run"].run_id
        total, items = DataGoKrHook(
            api_key_var=APT_LIST_KEY_VAR, min_interval=API_INTERVAL, transient_retries=3
        ).fetch_all(APT_LIST_SERVICE, PAGE_SIZE, sigunguCode=sgg_cd, _type="json")
        if len(items) != total:
            raise RuntimeError(f"{sgg_cd} 수신 {len(items)} != totalCount {total}")
        done = {
            r["kapt_code"]: r["basis"]
            for r in db.execute(
                """SELECT list_payload->>'kaptCode' AS kapt_code, basis_payload AS basis FROM staging.apt_raw
                   WHERE run_id = %s AND sgg_cd = %s AND basis_payload IS NOT NULL""",
                (run_id, sgg_cd),
                fetch=True,
            )
        }
        basis_hook = DataGoKrHook(api_key_var=APT_BASIS_KEY_VAR, min_interval=API_INTERVAL, transient_retries=3)
        fetched = dict(done)
        try:
            for it in items:
                code = it.get("kaptCode")
                if not code or code in fetched:
                    continue
                try:
                    res = basis_hook.call(APT_BASIS_SERVICE, kaptCode=code, _type="json")
                    fetched[code] = next((r for r in res.rows if r.get("kaptCode")), None)  # 없는 단지는 빈 item
                except GoKrLimitError:
                    raise
                except RuntimeError:  # 메시지에 인증키 없음 (Hook 처리)
                    fetched[code] = None
        finally:
            rows = [(run_id, sgg_cd, i, _dumps(it), _dumps(fetched.get(it.get("kaptCode"))))
                    for i, it in enumerate(items, 1)]  # fmt: skip
            with closing(db.get_conn()) as conn, conn, conn.cursor() as cur:
                cur.execute("DELETE FROM staging.apt_raw WHERE run_id = %s AND sgg_cd = %s", (run_id, sgg_cd))
