# ev12 충전기 상태 SQL: 마지막 확인일(무변경 포함)·지연 일수·최근 적재·현재 대수
from common import db

from .conftest import CHARGER_DATE

TODAY = "(now() AT TIME ZONE 'Asia/Seoul')::date"


def _status(cur):
    return db._run(cur, db.read_sql("ev12/charger_status.sql"), None, True)[0]


def _run(cur, run_id, status, days_ago, started):
    cur.execute(
        f"""INSERT INTO ops.pipeline_run (dag_id, run_id, partition_key, status, started_at)
            VALUES ('ev04_charger_daily', %s, ({TODAY} - %s)::text, %s, now() - make_interval(mins => %s))""",
        (run_id, days_ago, status, started),
    )


# 실행 기록 없음 → 확인일·지연 없음, 적재 이력은 그대로
def test_no_runs(cur, supply):
    s = _status(cur)
    assert s["last_check_date"] is None and s["lag_days"] is None and s["last_status"] is None
    assert str(s["load_date"]) == CHARGER_DATE and s["current_cnt"] == len(supply)


# 무변경도 확인일로 인정, 실패는 확인일 미갱신·마지막 상태로만 표시
def test_unchanged_counts_failed_not(cur, supply):
    _run(cur, "r1", "success", 2, 30)
    _run(cur, "r2", "unchanged", 1, 20)
    _run(cur, "r3", "failed", 0, 10)
    s = _status(cur)
    assert s["lag_days"] == 1 and s["last_status"] == "failed"
    _run(cur, "r4", "unchanged", 0, 0)
    s = _status(cur)
    assert s["lag_days"] == 0 and s["last_status"] == "unchanged"
