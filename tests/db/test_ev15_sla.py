# SLA 판정 SQL: 당일 완료 상태 여부·마지막 상태, ev03 연속 보류 일수
from common import db

EV03_OK = ["published", "republished", "skipped_unchanged"]


def _run(cur, dag_id, run_id, status, days_ago=0, mins_ago=0):
    cur.execute(
        """INSERT INTO ops.pipeline_run (dag_id, run_id, status, status_reason, started_at, finished_at)
           SELECT %s, %s, %s, %s, t, CASE WHEN %s <> 'running' THEN t END
           FROM (SELECT now() - make_interval(days => %s, mins => %s) AS t) x""",
        (dag_id, run_id, status, f"r-{run_id}", status, days_ago, mins_ago),
    )


# 기한 24시 = 당일 중 완료면 달성, 0시 = 당일 완료는 모두 기한 후
def _sla(cur, dag_id, ok, deadline_hour=24):
    params = {"dag_id": dag_id, "ok_statuses": ok, "deadline_hour": deadline_hour}
    return db._run(cur, db.read_sql("ev15/sla_status.sql"), params, True)[0]


def _streak(cur):
    return db._run(cur, db.read_sql("ev12/hold_streak.sql"), None, True)[0]


# 당일 실행 없음 → 미달, 전날 완료는 인정 안 함
def test_sla_no_run_today(cur):
    _run(cur, "ev04_charger_daily", "y", "success", days_ago=1)
    r = _sla(cur, "ev04_charger_daily", ["success", "unchanged"])
    assert (r["runs"], r["met"], r["last_status"], r["done_at"]) == (0, False, None, None)


# 보류 후 무변경 → 달성, 진행 중만 있으면 미달
def test_sla_met_and_running(cur):
    _run(cur, "ev03_mart_integration", "a", "held", mins_ago=30)
    assert _sla(cur, "ev03_mart_integration", EV03_OK)["met"] is False
    _run(cur, "ev03_mart_integration", "b", "skipped_unchanged", mins_ago=10)
    r = _sla(cur, "ev03_mart_integration", EV03_OK)
    assert (r["runs"], r["met"], r["last_status"], r["last_reason"]) == (2, True, "skipped_unchanged", "r-b")
    _run(cur, "ev04_charger_daily", "c", "running")
    assert _sla(cur, "ev04_charger_daily", ["success", "unchanged"])["met"] is False


# 기한 후 완료 → 미달, 완료 시각 표시
def test_sla_late(cur):
    _run(cur, "ev04_charger_daily", "late", "unchanged")
    r = _sla(cur, "ev04_charger_daily", ["success", "unchanged"], deadline_hour=0)
    assert r["met"] is False and r["done_at"] is not None
    assert _sla(cur, "ev04_charger_daily", ["success", "unchanged"])["met"] is True


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
