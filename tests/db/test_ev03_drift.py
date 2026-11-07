# 분포 비교 행 SQL: 후보 + 직전 게시 (같은 기준월 우선), 게시 이력 없으면 후보만
from common import db, drift

from .conftest import BASE_MONTH
from .test_ev03_publish import _publish, _resolve


def _candidate(cur, run_id):
    args = {**_resolve(cur), "run_id": run_id, "request_id": None}
    for f in ("admdong_timeband", "indicators", "supply", "region_gate", "classify"):
        db._run(cur, db.read_sql(f"ev03/{f}.sql"), args, False)
    return db._run(cur, db.read_sql("ev03/drift_rows.sql"), args, True)


def test_drift_rows_first_publish(cur, supply):
    rows = _candidate(cur, "d1")
    assert {r["side"] for r in rows} == {"cand"}
    assert drift.evaluate([], rows) == []


def test_drift_rows_same_month(cur, supply):
    _publish(cur, "d1")
    rows = _candidate(cur, "d2")
    prev = [r for r in rows if r["side"] == "prev"]
    cand = [r for r in rows if r["side"] == "cand"]
    assert len(prev) == len(cand) == 5 and {r["base_month"] for r in prev} == {BASE_MONTH}
    assert all(c["grade"] == "ok" for c in drift.evaluate(prev, cand))
