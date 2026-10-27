"""ev02 등록현황 월 배치 (설계서 §4.2)

기준월 결정 → 공표 대기 → 원천 분기(api | file) → 합류 후 검증·정규화·격리·품질 게이트 → 재공표 비교 → 적재 → 상태 확정
- api: 최신 월만 제공 (TbDongFuelCar). 정기 실행 경로
- file: 과거 월 보고서 양식 xlsx. 백필·재처리 경로
"""

import unicodedata
from contextlib import closing
from datetime import timedelta
from pathlib import Path

import pendulum
from airflow.providers.standard.operators.empty import EmptyOperator
from airflow.sdk import DAG, CronTriggerTimetable, Param, task
from airflow.sdk.exceptions import AirflowFailException
from common import db, ops
from common.assets import EV_REG_SNAPSHOT
from common.xlsx_report import parse_report
from config.default_args import DEFAULT_ARGS
from hooks.seoul_openapi_hook import SeoulOpenApiHook
from sensors.seoul_api_base_month_sensor import SeoulApiBaseMonthSensor

KST = "Asia/Seoul"
SERVICE = "TbDongFuelCar"
API_KEY_VAR = "apikey_seoul_registration"
PAGE_SIZE = 1000
MASTER_DIR = Path("/opt/airflow/files/master")
API_POOL = "seoul_registration_api_pool"

# 품질 게이트 기준
MIN_MAPPING_RATE = 0.95  # 활성 경계 대비 매칭 행정동 비율 (미만 치명)
WARN_QUARANTINE_RATIO = 0.05  # 격리 행 비율 (초과 경고)

FINAL_TASKS = [
    "resolve_base_month", "wait_base_month_published", "choose_source", "extract_reg_api", "extract_reg_file",
    "validate_base_month", "reconcile_totals", "normalize_admdong_fuel", "quarantine_unmapped",
    "snapshot_gate", "compare_with_existing", "skip_identical", "load_snapshot",
]  # fmt: skip


# 파일명 정규화 매칭 (macOS 한글 NFD 대응)
def _find_file(name):
    target = unicodedata.normalize("NFC", name)
    for p in MASTER_DIR.iterdir():
        if unicodedata.normalize("NFC", p.name) == target:
            return p
    return None


def _load_staging(run_id, base_month, source, source_ref, rows):
    sql = (
        """INSERT INTO staging.registration_raw (run_id, row_no, source, source_ref, base_month, stats_ym, sgg_cd,
                 dong_cd, fuel_cd, sgg_nm, adstrd_nm, fuel_nm, sum11, sum12, sum13, sum14, sum21, sum22, sum23, sum24,
                 sum31, sum32, sum33, sum34, sum_tot) VALUES ("""
        + ", ".join(["%s"] * 25)
        + ")"
    )
    # 드라이버 무관 일괄 삽입 (PostgresHook 이 psycopg 3 연결 반환)
    with closing(db.get_conn()) as conn, conn, conn.cursor() as cur:
        cur.execute("DELETE FROM staging.registration_raw WHERE run_id = %s", (run_id,))  # 재시도 멱등
        cur.executemany(sql, [(run_id, i, source, source_ref, base_month, *r) for i, r in enumerate(rows, 1)])


with DAG(
    dag_id="ev02_registration_monthly",
    description="행정동별 연료별 등록현황 월 스냅샷",
    schedule=CronTriggerTimetable("0 9 1 * *", timezone=KST),
    start_date=pendulum.datetime(2026, 10, 1, tz=KST),
    catchup=False,
    max_active_runs=1,
    default_args=DEFAULT_ARGS,
    params={
        "base_month": Param(None, type=["null", "string"], pattern=r"^\d{6}$", description="YYYYMM, 비우면 전월"),
        "source": Param("api", enum=["api", "file"], description="api: 최신 월 / file: 과거 월 보고서"),
        "file_name": Param(None, type=["null", "string"], description="file 경로일 때 files/master 내 파일명"),
        "request_id": Param(None, type=["null", "integer"], description="ev11 재처리 요청 ID"),
    },
    tags=["ev", "collect", "registration"],
) as dag:

    # 기준월 명시 결정: params 우선, 없으면 실행 시각(KST) 전월
    @task(pool=API_POOL, queue="api")
    def resolve_base_month(**context):
        p = context["params"]
        run_after = pendulum.instance(context["dag_run"].run_after).in_timezone(KST)  # SDK 는 datetime 반환
        base_month = p["base_month"] or run_after.subtract(months=1).format("YYYYMM")
        info = {"base_month": base_month, "source": p["source"], "file_name": p["file_name"]}
        if info["source"] == "file" and (not info["file_name"] or _find_file(info["file_name"]) is None):
            raise AirflowFailException(f"file 경로 파일 없음: {info['file_name']}")
        if info["source"] == "api":
            # API는 최신 월만 제공 → 지난 월 요청은 file 경로로 (센서 soft_fail 과 구분하려고 여기서 판정)
            r = SeoulOpenApiHook(api_key_var=API_KEY_VAR).call(SERVICE, 1, 1)
            latest = r.rows[0]["STATS_YM"] if r.rows else None
            if latest and latest > base_month:
                raise AirflowFailException(f"API 최신 월 {latest} > 대상 {base_month}: file 경로 사용")
        ops.record_run(context, "running", partition_key=base_month, detail=info)
        return info

    # 공표 대기 (커스텀 센서): 대상 월이 원천에 있을 때까지, reschedule 로 워커 슬롯 비점유
    published = SeoulApiBaseMonthSensor(
        task_id="wait_base_month_published",
        service=SERVICE,
        api_key_var=API_KEY_VAR,
        base_month="{{ ti.xcom_pull(task_ids='resolve_base_month')['base_month'] }}",
        source="{{ ti.xcom_pull(task_ids='resolve_base_month')['source'] }}",
        poke_interval=3600,
        timeout=timedelta(days=20).total_seconds(),
        soft_fail=True,  # 공표 지연은 실패가 아니라 publication_delayed
        pool=API_POOL,
        queue="api",
    )

    @task.branch
    def choose_source(info):
        return "extract_reg_api" if info["source"] == "api" else "extract_reg_file"

    @task(pool=API_POOL, queue="api")
    def extract_reg_api(info, **context):
        total, rows = SeoulOpenApiHook(api_key_var=API_KEY_VAR).fetch_all(SERVICE, PAGE_SIZE)
        cols = ["STATS_YM", "SGG_CD", "DONG_CD", "FUEL_CD", "SGG_NM", "ADSTRD_NM", "FUEL_NM"]
        sums = [f"SUM{g}{i}" for g in (1, 2, 3) for i in (1, 2, 3, 4)] + ["SUM_TOT"]
        _load_staging(
            context["dag_run"].run_id,
            info["base_month"],
            "api",
            SERVICE,
            [[r.get(c) for c in cols + sums] for r in rows],
        )
        return {"expected_rows": total, "loaded_rows": len(rows)}

    @task
    def extract_reg_file(info, **context):
        path = _find_file(info["file_name"])
        stats_ym, details, seoul_total = parse_report(path)
        rows = [
            [stats_ym, None, None, None, d["sgg_nm"], d["adstrd_nm"], d["fuel_nm"], *d["sums"], d["sum_tot"]]
            for d in details
        ]
        _load_staging(context["dag_run"].run_id, info["base_month"], "file", path.name, rows)
        return {"expected_total": seoul_total, "loaded_rows": len(rows)}

    # 분기 합류: 실행된 경로 하나만 성공하면 진행
    @task(trigger_rule="none_failed_min_one_success")
    def validate_base_month(info, **context):
        dist = db.execute_file("ev02/check_base_month.sql", {"run_id": context["dag_run"].run_id}, fetch=True)
        months = {r["stats_ym"] for r in dist}
        ok = months == {info["base_month"]}
        ops.record_quality(context, "base_month", "ok" if ok else "fatal", detail={"found": sorted(months)})
        if not ok:
            raise AirflowFailException(f"기준월 불일치: 대상 {info['base_month']}, 원천 {sorted(months)}")

    # 총건수 대조: api는 list_total_count, file은 서울 합계
    @task
    def reconcile_totals(info, **context):
        ti = context["ti"]
        run_id = context["dag_run"].run_id
        api = ti.xcom_pull(task_ids="extract_reg_api")
        if info["source"] == "api":
            metric, expected = api["loaded_rows"], api["expected_rows"]
        else:
            file = ti.xcom_pull(task_ids="extract_reg_file")
            rows = db.execute(
                "SELECT coalesce(sum(detail_sum), 0) AS s FROM staging.v_registration_match WHERE run_id = %s",
                (run_id,),
                fetch=True,
            )
            metric, expected = rows[0]["s"], file["expected_total"]
        ok = metric == expected
        ops.record_quality(context, "total_reconcile", "ok" if ok else "fatal", metric=metric, threshold=expected)
        if not ok:
            raise AirflowFailException(f"총건수 불일치: {metric} != {expected}")

    @task
    def normalize_admdong_fuel(**context):
        db.execute_file("ev02/normalize.sql", {"run_id": context["dag_run"].run_id})

    @task
    def quarantine_unmapped(**context):
        db.execute_file("ev02/quarantine.sql", {"run_id": context["dag_run"].run_id})

    # 품질 게이트: 치명 → 적재 차단, 경고 → 기록 후 진행
    @task
    def snapshot_gate(**context):
        m = db.execute_file("ev02/gate_metrics.sql", {"run_id": context["dag_run"].run_id}, fetch=True)[0]
        mapping_rate = m["mapped_dongs"] / m["active_dongs"] if m["active_dongs"] else 0
        q_ratio = m["quarantine_rows"] / m["raw_rows"] if m["raw_rows"] else 1
        fatal = mapping_rate < MIN_MAPPING_RATE or m["total_cnt"] == 0
        grade = "fatal" if fatal else ("warn" if q_ratio > WARN_QUARANTINE_RATIO or m["sum_tot_mismatch"] else "ok")
        ops.record_quality(
            context, "mapping_rate", "fatal" if fatal else "ok", round(mapping_rate, 4), MIN_MAPPING_RATE
        )
        ops.record_quality(context, "quarantine_ratio", grade, round(q_ratio, 4), WARN_QUARANTINE_RATIO, detail=m)
        if fatal:
            raise AirflowFailException(f"품질 치명: 매칭률 {mapping_rate:.2%}, 합계 {m['total_cnt']}")
        return grade

    # 재공표 비교: 내용 같으면 적재 생략 (Asset 미발생 → ev03 불필요 실행 방지)
    @task.branch
    def compare_with_existing(info, **context):
        h = db.execute_file(
            "ev02/content_hash.sql", {"run_id": context["dag_run"].run_id, "base_month": info["base_month"]}, fetch=True
        )[0]
        context["ti"].xcom_push(key="hash", value=h)
        return "skip_identical" if h["content_hash"] == h["prev_hash"] else "load_snapshot"

    skip_identical = EmptyOperator(task_id="skip_identical")

    # 이력 기록 + 파티션 교체 단일 트랜잭션, 성공 시에만 Asset 이벤트
    @task(outlets=[EV_REG_SNAPSHOT])
    def load_snapshot(info, grade, **context):
        run_id = context["dag_run"].run_id
        h = context["ti"].xcom_pull(task_ids="compare_with_existing", key="hash")
        params = {
            "run_id": run_id, "base_month": info["base_month"], "source": info["source"],
            "source_ref": info["file_name"] or SERVICE, "row_cnt": h["row_cnt"], "content_hash": h["content_hash"],
            "quality_grade": grade,
        }  # fmt: skip
        res = db.run_in_transaction([("ev02/load_log.sql", params, True), ("ev02/load_replace.sql", params, False)])
        context["outlet_events"][EV_REG_SNAPSHOT].extra = {
            "base_month": info["base_month"], "load_id": res["load_id"], "request_id": context["params"]["request_id"],
        }  # fmt: skip
        return {"load_id": res["load_id"], "republished": res["prev_load_id"] is not None}

    # 최종 상태 확정: 어떤 경로든 실행, 핵심 실패면 DAG 실패
    @task(trigger_rule="all_done")
    def record_run(**context):
        states = ops.task_states(context, FINAL_TASKS)
        failed = [t for t, s in states.items() if s in ("failed", "upstream_failed")]
        info = context["ti"].xcom_pull(task_ids="resolve_base_month") or {}
        base_month = info.get("base_month")
        if failed:
            ops.record_run(context, "failed", base_month, reason=f"실패 Task: {failed}")
            raise AirflowFailException(f"핵심 처리 실패: {failed}")
        if states.get("wait_base_month_published") == "skipped":
            status, reason = "publication_delayed", "공표 대기 시간 초과"
        elif states.get("skip_identical") == "success":
            status, reason = "unchanged", "재공표 내용 동일"
        else:
            load = context["ti"].xcom_pull(task_ids="load_snapshot") or {}
            status = "republished" if load.get("republished") else "success"
            reason = f"load_id={load.get('load_id')}"
        ops.record_run(context, status, base_month, reason=reason)

    info = resolve_base_month()
    branch = choose_source(info)
    api = extract_reg_api(info)
    file = extract_reg_file(info)
    validated = validate_base_month(info)
    reconciled = reconcile_totals(info)
    normalized = normalize_admdong_fuel()
    quarantined = quarantine_unmapped()
    grade = snapshot_gate()
    compare = compare_with_existing(info)
    loaded = load_snapshot(info, grade)
    done = record_run()

    (
        info
        >> published
        >> branch
        >> [api, file]
        >> validated
        >> reconciled
        >> normalized
        >> quarantined
        >> grade
        >> compare
    )
    compare >> [skip_identical, loaded]
    [skip_identical, loaded] >> done
