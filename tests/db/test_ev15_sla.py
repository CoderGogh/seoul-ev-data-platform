# SLA 판정 SQL: 당일 완료 상태 여부·마지막 상태, ev03 연속 보류 일수
from common import db

EV03_OK = ["published", "republished", "skipped_unchanged"]


def _run(cur, dag_id, run_id, status, days_ago=0, mins_ago=0):
    cur.execute(
        """INSERT INTO ops.pipeline_run (dag_id, run_id, status, status_reason, started_at)
           VALUES (%s, %s, %s, %s, now() - make_interval(days => %s, mins => %s))""",
        (dag_id, run_id, status, f"r-{run_id}", days_ago, mins_ago),
    )


def _sla(cur, dag_id, ok):
    return db._run(cur, db.read_sql("ev15/sla_status.sql"), {"dag_id": dag_id, "ok_statuses": ok}, True)[0]


def _streak(cur):
    return db._run(cur, db.read_sql("ev12/hold_streak.sql"), None, True)[0]


# 당일 실행 없음 → 미달, 전날 완료는 인정 안 함
def test_sla_no_run_today(cur):
    _run(cur, "ev04_charger_daily", "y", "success", days_ago=1)
    r = _sla(cur, "ev04_charger_daily", ["success", "unchanged"])
    assert (r["runs"], r["met"], r["last_status"]) == (0, False, None)


# 보류 후 무변경 → 달성, 진행 중만 있으면 미달
def test_sla_met_and_running(cur):
    _run(cur, "ev03_mart_integration", "a", "held", mins_ago=30)
    assert _sla(cur, "ev03_mart_integration", EV03_OK)["met"] is False
    _run(cur, "ev03_mart_integration", "b", "skipped_unchanged", mins_ago=10)
    r = _sla(cur, "ev03_mart_integration", EV03_OK)
    assert (r["runs"], r["met"], r["last_status"], r["last_reason"]) == (2, True, "skipped_unchanged", "r-b")
    _run(cur, "ev04_charger_daily", "c", "running")
    assert _sla(cur, "ev04_charger_daily", ["success", "unchanged"])["met"] is False


# 연속 보류: 마지막 게시 이후 보류된 날만 셈, 같은 날 게시되면 제외
def test_hold_streak(cur):
    assert _streak(cur)["held_days"] == 0
    _run(cur, "ev03_mart_integration", "p", "published", days_ago=4)
    _run(cur, "ev03_mart_integration", "h1", "held", days_ago=3)
    _run(cur, "ev03_mart_integration", "h2", "held", days_ago=1)
    _run(cur, "ev03_mart_integration", "h3", "held", days_ago=0)
    s = _streak(cur)
    assert s["held_days"] == 3 and s["last_ok_day"] < s["held_since"]
    _run(cur, "ev03_mart_integration", "u", "skipped_unchanged", days_ago=0)
    assert _streak(cur)["held_days"] == 0
