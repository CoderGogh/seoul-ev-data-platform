# ev03 게시 경로 DB 통합 테스트: 분류·파티션 교체·계보·보류·무변경·원자성
import psycopg
import pytest
from common import db

from .conftest import BASE_MONTH, EXPECTED_CLASS, TARGET_SET, WINDOW, rows


def _resolve(cur):
    args = {"base_month": None, "target_set": TARGET_SET, **WINDOW}
    return {**args, **db._run(cur, db.read_sql("ev03/resolve_target.sql"), args, True)[0]}


# DAG 진행 경로와 같은 순서로 SQL 실행 (resolve → 집계 → 지표 → Gate 2 → 분류 → 게시)
def _publish(cur, run_id):
    info = _resolve(cur)
    args = {**info, "run_id": run_id, "request_id": None}
    for f in ("admdong_timeband", "indicators", "region_gate", "classify", "publish"):
        db._run(cur, db.read_sql(f"ev03/{f}.sql"), args, False)
    return info


def _hold(cur, run_id, reason="테스트 보류"):
    info = _resolve(cur)
    args = {"run_id": run_id, "base_month": info["base_month"], "fingerprint": info["fingerprint"], "reason": reason}
    db._run(cur, db.read_sql("ev03/hold.sql"), args, False)


def _fact(cur):
    return {
        r["adm_cd"]: r
        for r in rows(cur, "SELECT * FROM mart.fact_admdong_indicator WHERE base_month = %s", (BASE_MONTH,))
    }


# 대상 기준월·지문: 최신 스냅샷, 전년 동월, 활성 버전
def test_resolve_target(cur, seed):
    info = _resolve(cur)
    assert info["base_month"] == BASE_MONTH and info["prev_month"] == "202509"
    assert (info["link_ver"], info["boundary_ver"], info["threshold_ver"]) == ("lt", "bt", "mvp_v2")
    assert info["fingerprint"] and info["last_fingerprint"] is None


# Gate 1 지표: 커버리지 분모·분자
def test_gate1_metrics(cur, seed):
    info = _resolve(cur)
    m = db._run(cur, db.read_sql("ev03/gate1_checks.sql"), info, True)[0]
    assert (m["target_links"], m["expected_hours"], m["active_masters"]) == (9, 15, 2)
    assert m["observed_link_hours"] == 3 * 15 + 3 * 15 + 3 * 2
    assert m["observed_hours"] == 15 and m["target_on_active_link"]


# 게시: 분류·도로 여건·계보·후보 정리
def test_publish_classification_and_lineage(cur, seed):
    _publish(cur, "r1")
    fact = _fact(cur)
    assert {k: v["classification"] for k, v in fact.items()} == EXPECTED_CLASS
    assert fact["1168000001"]["charger_hint"] == "slow"  # 저속 비중 100%
    assert fact["1168000004"]["quality_grade"] == "fatal"
    assert "low_coverage" in fact["1168000003"]["reason_codes"]
    log = rows(cur, "SELECT * FROM ops.publish_log WHERE base_month = %s", (BASE_MONTH,))
    assert len(log) == 1 and log[0]["region_cnt"] == 4 and log[0]["reg_load_id"] == seed[BASE_MONTH]
    status = rows(cur, "SELECT * FROM ops.publish_status WHERE base_month = %s", (BASE_MONTH,))[0]
    assert (status["status"], status["last_published_run"]) == ("current", "r1")
    left = rows(cur, "SELECT count(*) AS n FROM mart.candidate_admdong_indicator WHERE run_id = 'r1'")[0]["n"]
    assert left == 0


# 재게시: 기준월 파티션 전체 교체 (중복 없음), 게시 로그 누적
def test_republish_replaces_partition(cur, seed):
    _publish(cur, "r1")
    _publish(cur, "r2")
    fact = _fact(cur)
    assert len(fact) == 4 and {v["run_id"] for v in fact.values()} == {"r2"}
    n = rows(cur, "SELECT count(*) AS n FROM ops.publish_log WHERE base_month = %s", (BASE_MONTH,))[0]["n"]
    assert n == 2


# 무변경 판정: 같은 입력이면 지문 동일, 새 등록 적재면 달라짐
def test_fingerprint_unchanged_then_changed(cur, seed):
    _publish(cur, "r1")
    info = _resolve(cur)
    assert info["fingerprint"] == info["last_fingerprint"]
    cur.execute(
        """INSERT INTO ops.reg_load (base_month, source, run_id, row_cnt, content_hash, quality_grade)
           VALUES (%s, 'api', 'reg_new', 0, 'x', 'ok') RETURNING load_id""",
        (BASE_MONTH,),
    )
    cur.execute("UPDATE core.reg_snapshot SET load_id = %s WHERE base_month = %s", (cur.fetchone()[0], BASE_MONTH))
    info = _resolve(cur)
    assert info["fingerprint"] != info["last_fingerprint"]


# 보류: 게시 이력 없으면 never_published, 있으면 stale + 이전 결과 유지
def test_hold_keeps_previous_result(cur, seed):
    _hold(cur, "h0")
    assert rows(cur, "SELECT status FROM ops.publish_status WHERE base_month = %s", (BASE_MONTH,))[0]["status"] == (
        "never_published"
    )
    _publish(cur, "r1")
    _hold(cur, "h1")
    status = rows(cur, "SELECT * FROM ops.publish_status WHERE base_month = %s", (BASE_MONTH,))[0]
    assert (status["status"], status["last_published_run"]) == ("stale", "r1")
    assert {v["run_id"] for v in _fact(cur).values()} == {"r1"}
    ev = rows(cur, "SELECT eval_status FROM ops.mart_eval WHERE run_id = 'h1'")[0]["eval_status"]
    assert ev == "held"


# 원자성: 게시 중 실패하면 운영 마트·계보 변경 없음
def test_publish_failure_rolls_back(cur, seed):
    _publish(cur, "r1")
    info = _resolve(cur)
    args = {**info, "run_id": "r_bad", "request_id": None}
    for f in ("admdong_timeband", "indicators", "region_gate", "classify"):
        db._run(cur, db.read_sql(f"ev03/{f}.sql"), args, False)
    cur.execute("SAVEPOINT before_publish")
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        db._run(cur, db.read_sql("ev03/publish.sql"), {**args, "threshold_ver": "없는_버전"}, False)
    cur.execute("ROLLBACK TO SAVEPOINT before_publish")
    assert {v["run_id"] for v in _fact(cur).values()} == {"r1"}
    n = rows(cur, "SELECT count(*) AS n FROM ops.publish_log WHERE run_id = 'r_bad'")[0]["n"]
    assert n == 0
