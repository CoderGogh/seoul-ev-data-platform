# ev12 호출량 SQL: 기간 내 호출·한도 오류, ev01 오류율 등급 분포
from common import db


def _usage(cur, hours=24):
    return db._run(cur, db.read_sql("ev12/api_usage.sql"), {"hours": hours, "limit_code": "ERROR-337"}, True)[0]


def test_calls_limit_and_grades(cur):
    cur.execute(
        """INSERT INTO staging.traffic_raw (poll_batch_id, link_id, run_id, chunk_no, collected_at, result_code,
               call_status) VALUES
           ('b1', 'l1', 'r1', 0, now(), 'INFO-000', 'ok'),
           ('b1', 'l2', 'r1', 0, now(), 'ERROR-337', 'api_error'),
           ('b0', 'l1', 'r0', 0, now() - interval '2 days', 'ERROR-337', 'api_error')"""
    )
    cur.execute(
        """INSERT INTO ops.quality_result (dag_id, run_id, check_name, grade, metric) VALUES
           ('ev01_traffic_collect', 'r1', 'api_error_rate', 'ok', 0),
           ('ev01_traffic_collect', 'r2', 'api_error_rate', 'warn', 0.05),
           ('ev01_traffic_collect', 'r3', 'api_error_rate', 'fatal', 0.5),
           ('ev01_traffic_collect', 'r3', 'coverage', 'ok', 1)"""
    )
    s = _usage(cur)
    assert (s["calls"], s["limit_errors"]) == (2, 1)  # 2일 전 기록 제외
    assert (s["batches"], s["ok_cnt"], s["warn_cnt"], s["fatal_cnt"]) == (3, 1, 1, 1)
    assert float(s["p50"]) == 0.05 and float(s["max"]) == 0.5


def test_empty(cur):
    s = _usage(cur)
    assert s["calls"] == 0 and s["batches"] == 0 and s["p50"] is None
