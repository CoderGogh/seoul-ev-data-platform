"""ev04 충전기 공급 일 배치 (설계서 §4.4)

대상 구 결정 → 구별 수집(동적 매핑) → 건수 대조 → 격리 → 정제·동 귀속 → 품질 게이트 → 변경 비교 → 이력 반영 → 상태 확정
- 원천은 현재 상태만 제공 → 수집일(KST) 기준 스냅샷, 과거 날짜 재적재 불가
- 구 하나라도 수집 실패면 반영 안 함 (누락분이 소멸로 기록되는 것 방지)
- 이력은 SCD2 (core.charger), 변경 없으면 Asset 미발생
"""

import json
from contextlib import closing

import pendulum
from airflow.providers.standard.operators.empty import EmptyOperator
from airflow.sdk import DAG, CronTriggerTimetable, Param, task
from airflow.sdk.exceptions import AirflowFailException
from common import db, ops
from common.assets import EV_CHARGER_SUPPLY
from config.default_args import DEFAULT_ARGS
from hooks.data_go_kr_hook import DataGoKrHook

KST = "Asia/Seoul"
SERVICE = "B552584/EvCharger/getChargerInfo"
API_KEY_VAR = "apikey_ev_charger"
API_POOL = "ev_charger_api_pool"
SEOUL_ZCODE = "11"
PAGE_SIZE = 1000  # 6천 건 단일 요청 시 504 (2026-11-02 실측)

# 품질 게이트 기준
MIN_ASSIGN_RATE = 0.95  # 정제 행 대비 행정동 귀속 비율 (미만 치명)
WARN_QUARANTINE_RATIO = 0.05  # 격리 행 비율 (초과 경고)
WARN_MISMATCH_RATIO = 0.005  # 좌표 귀속 구 ≠ 요청 구 비율 (초과 경고, 원천 좌표 오류)
MAX_CLOSE_RATIO = 0.10  # 구별 직전 대비 소멸 비율 (초과 치명, 원천 일부 누락 의심)

FINAL_TASKS = [
    "init_run", "list_sgg", "extract_sgg", "reconcile_counts", "quarantine_invalid", "normalize_assign",
    "snapshot_gate", "compare_with_current", "skip_unchanged", "load_charger",
]  # fmt: skip

INSERT_RAW = "INSERT INTO staging.charger_raw (run_id, sgg_cd, row_no, payload) VALUES (%s, %s, %s, %s)"


with DAG(
    dag_id="ev04_charger_daily",
    description="전기차 충전기 공급 일 스냅샷 (한국환경공단 충전소 정보)",
    schedule=CronTriggerTimetable("0 5 * * *", timezone=KST),  # ev03 06:00 이전
    start_date=pendulum.datetime(2026, 11, 1, tz=KST),
    catchup=False,
    max_active_runs=1,
    default_args=DEFAULT_ARGS,
    params={
        "target_set": Param("mvp_3gu_v1", type="string", description="대상 링크 세트 (대상 구 결정)"),
        "sgg_cds": Param(
            [], type="array", items={"type": "string", "pattern": r"^\d{5}$"}, description="비우면 대상 세트 구"
        ),
        "allow_mass_close": Param(False, type="boolean", description="소멸 비율 게이트 생략 (원천 정비 확인 후만)"),
    },
    tags=["ev", "collect", "charger"],
) as dag:

    # 수집일·대상 구 결정, 과거 날짜 재적재 차단
    @task
    def init_run(**context):
        p = context["params"]
        snapshot_date = pendulum.now(KST).date()  # 원천은 현재 상태 → 실행 시각 기준
        sggs = p["sgg_cds"] or [
            r["sgg_cd"] for r in db.execute_file("ev04/target_sgg.sql", {"target_set": p["target_set"]}, fetch=True)
        ]
        if not sggs:
            raise AirflowFailException(f"대상 구 없음: {p['target_set']}")
        last = db.execute("SELECT max(snapshot_date) AS d FROM ops.charger_load", fetch=True)[0]["d"]
        if last and snapshot_date < last:
            raise AirflowFailException(f"수집일 {snapshot_date} < 최근 적재 {last}: 과거 날짜 재적재 불가")
        info = {"snapshot_date": snapshot_date.isoformat(), "sgg_cds": sggs}
        ops.record_run(context, "running", partition_key=info["snapshot_date"], detail=info)
        return info

    @task
    def list_sgg(info):
        return info["sgg_cds"]

    # 구별 전수 수집 → staging (재시도 멱등: 같은 run·구 삭제 후 적재)
    @task(pool=API_POOL, queue="api", retries=3)
    def extract_sgg(sgg_cd, **context):
        run_id = context["dag_run"].run_id
        total, rows = DataGoKrHook(api_key_var=API_KEY_VAR).fetch_all(
            SERVICE, PAGE_SIZE, zcode=SEOUL_ZCODE, zscode=sgg_cd
        )
        if len(rows) != total:
            raise RuntimeError(f"{sgg_cd} 수신 {len(rows)} != totalCount {total}")
        with closing(db.get_conn()) as conn, conn, conn.cursor() as cur:
            cur.execute("DELETE FROM staging.charger_raw WHERE run_id = %s AND sgg_cd = %s", (run_id, sgg_cd))
            cur.executemany(
                INSERT_RAW, [(run_id, sgg_cd, i, json.dumps(r, ensure_ascii=False)) for i, r in enumerate(rows, 1)]
            )
        return {"sgg_cd": sgg_cd, "total": total}

    # 건수 대조: 원천 totalCount = staging 적재 (구별)
    @task
    def reconcile_counts(extracted, **context):
        run_id = context["dag_run"].run_id
        loaded = {
            r["sgg_cd"]: r["n"]
            for r in db.execute(
                "SELECT sgg_cd, count(*) AS n FROM staging.charger_raw WHERE run_id = %s GROUP BY 1",
                (run_id,),
                fetch=True,
            )
        }
        bad = []
        for e in extracted:
            n = loaded.get(e["sgg_cd"], 0)
            ok = n == e["total"]
            ops.record_quality(
                context, "total_reconcile", "ok" if ok else "fatal", n, e["total"], scope_key=e["sgg_cd"]
            )
            if not ok:
                bad.append(e["sgg_cd"])
        if bad:
            raise AirflowFailException(f"건수 불일치 구: {bad}")

    @task
    def quarantine_invalid(**context):
        db.execute_file("ev04/quarantine.sql", {"run_id": context["dag_run"].run_id})

    @task
    def normalize_assign(**context):
        db.execute_file("ev04/normalize.sql", {"run_id": context["dag_run"].run_id})

    # 품질 게이트: 귀속률 미달·빈 결과 → 치명, 격리 비율 → 경고
    @task
    def snapshot_gate(**context):
        m = db.execute_file("ev04/gate_metrics.sql", {"run_id": context["dag_run"].run_id}, fetch=True)[0]
        assign_rate = m["assigned_rows"] / m["norm_rows"] if m["norm_rows"] else 0
        q_ratio = m["quarantine_rows"] / m["raw_rows"] if m["raw_rows"] else 1
        fatal = m["norm_rows"] == 0 or assign_rate < MIN_ASSIGN_RATE
        mismatch = m["sgg_mismatch_rows"] / m["norm_rows"] if m["norm_rows"] else 0
        warn = q_ratio > WARN_QUARANTINE_RATIO or mismatch > WARN_MISMATCH_RATIO or m["unknown_type_rows"]
        grade = "fatal" if fatal else ("warn" if warn else "ok")
        ops.record_quality(context, "assign_rate", "fatal" if fatal else "ok", round(assign_rate, 4), MIN_ASSIGN_RATE)
        ops.record_quality(context, "quarantine_ratio", grade, round(q_ratio, 4), WARN_QUARANTINE_RATIO, detail=m)
        if fatal:
            raise AirflowFailException(f"품질 치명: 귀속률 {assign_rate:.2%}, 정제 {m['norm_rows']}건")
        return grade

    # 직전 상태 대비 변경 비교: 대량 소멸 차단, 변경 없으면 반영 생략
    @task.branch
    def compare_with_current(info, **context):
        p = context["params"]
        rows = db.execute_file(
            "ev04/diff.sql",
            {"run_id": context["dag_run"].run_id, "snapshot_date": info["snapshot_date"], "sgg_cds": info["sgg_cds"]},
            fetch=True,
        )
        blocked = []
        for r in rows:
            ratio = r["closed_cnt"] / r["prev_cnt"] if r["prev_cnt"] else 0
            over = ratio > MAX_CLOSE_RATIO and not p["allow_mass_close"]
            ops.record_quality(
                context, "close_ratio", "fatal" if over else "ok", round(ratio, 4), MAX_CLOSE_RATIO,
                scope_key=r["sgg_cd"], detail=r,
            )  # fmt: skip
            if over:
                blocked.append(r["sgg_cd"])
        if blocked:
            raise AirflowFailException(f"소멸 비율 초과 구: {blocked} (원천 확인 후 allow_mass_close)")
        totals = {k: sum(r[k] for r in rows) for k in ("cur_cnt", "new_cnt", "changed_cnt", "closed_cnt")}
        context["ti"].xcom_push(key="diff", value=totals)
        # 같은 날 반영분 존재 → 변경 0건이어도 되돌림 필요
        applied_today = db.execute(
            """SELECT EXISTS (SELECT 1 FROM core.charger WHERE sgg_cd = ANY (%(sgg_cds)s)
                              AND (valid_from = %(snapshot_date)s OR valid_to = %(snapshot_date)s)) AS e""",
            {"snapshot_date": info["snapshot_date"], "sgg_cds": info["sgg_cds"]},
            fetch=True,
        )[0]["e"]
        changed = totals["new_cnt"] or totals["changed_cnt"] or totals["closed_cnt"]
        return "load_charger" if changed or applied_today else "skip_unchanged"

    skip_unchanged = EmptyOperator(task_id="skip_unchanged")

    # 적재 이력 + 이력 반영 단일 트랜잭션, 성공 시에만 Asset 이벤트
    @task(outlets=[EV_CHARGER_SUPPLY])
    def load_charger(info, grade, **context):
        d = context["ti"].xcom_pull(task_ids="compare_with_current", key="diff")
        params = {
            "run_id": context["dag_run"].run_id, "snapshot_date": info["snapshot_date"], "sgg_cds": info["sgg_cds"],
            "row_cnt": d["cur_cnt"], "new_cnt": d["new_cnt"], "changed_cnt": d["changed_cnt"],
            "closed_cnt": d["closed_cnt"], "quality_grade": grade,
        }  # fmt: skip
        res = db.run_in_transaction([("ev04/load_log.sql", params, True), ("ev04/apply_scd.sql", params, False)])
        context["outlet_events"][EV_CHARGER_SUPPLY].extra = {
            "snapshot_date": info["snapshot_date"], "load_id": res["load_id"],
        }  # fmt: skip
        return {"load_id": res["load_id"], **d}

    # 최종 상태 확정: 어떤 경로든 실행, 핵심 실패면 DAG 실패
    @task(trigger_rule="all_done")
    def record_run(**context):
        states = ops.task_states(context, FINAL_TASKS)
        failed = [t for t, s in states.items() if s in ("failed", "upstream_failed")]
        info = context["ti"].xcom_pull(task_ids="init_run") or {}
        snapshot_date = info.get("snapshot_date")
        if failed:
            ops.record_run(context, "failed", snapshot_date, reason=f"실패 Task: {failed}")
            raise AirflowFailException(f"핵심 처리 실패: {failed}")
        if states.get("skip_unchanged") == "success":
            ops.record_run(context, "unchanged", snapshot_date, reason="직전 상태와 동일")
            return
        load = context["ti"].xcom_pull(task_ids="load_charger") or {}
        counts = f"신규 {load.get('new_cnt')}·변경 {load.get('changed_cnt')}·소멸 {load.get('closed_cnt')}"
        reason = f"load_id={load.get('load_id')} {counts}"
        ops.record_run(context, "success", snapshot_date, reason=reason, detail=load)

    info = init_run()
    extracted = extract_sgg.expand(sgg_cd=list_sgg(info))
    reconciled = reconcile_counts(extracted)
    quarantined = quarantine_invalid()
    normalized = normalize_assign()
    grade = snapshot_gate()
    compare = compare_with_current(info)
    loaded = load_charger(info, grade)
    done = record_run()

    reconciled >> quarantined >> normalized >> grade >> compare
    compare >> [skip_unchanged, loaded]
    [skip_unchanged, loaded] >> done
