# 도로 관측 월 파티션: 전환·파티션 보장·멱등 적재·프루닝·만료 파티션 삭제(보호 조건)
from common import db

from .conftest import rows

OLD = "2025-01-15 10:10:00+09"  # 보존 기간 지난 달


def _parts(cur):
    return {r["relname"] for r in rows(cur, """SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
                                               WHERE i.inhparent = 'core.traffic_obs'::regclass""")}  # fmt: skip


def test_partitioned_and_ensure_idempotent(cur):
    assert rows(cur, "SELECT relkind FROM pg_class WHERE oid = 'core.traffic_obs'::regclass")[0]["relkind"] == "p"
    cur.execute("SELECT core.ensure_traffic_obs_partitions(%s::timestamptz, 2)", (OLD,))
    assert cur.fetchone()[0] == 2
    cur.execute("SELECT core.ensure_traffic_obs_partitions(%s::timestamptz, 2)", (OLD,))
    assert cur.fetchone()[0] == 0
    assert {"traffic_obs_202501", "traffic_obs_202502"} <= _parts(cur)


# 같은 회차 재적재는 중복 없음 (멱등 키 = 링크 × 회차)
def test_load_obs_idempotent(cur):
    cur.execute(
        """INSERT INTO staging.traffic_raw (poll_batch_id, link_id, run_id, chunk_no, collected_at, result_code,
               call_status, prcs_spd, prcs_trv_time) VALUES
           ('pb1', 'L1', 'r', 0, now(), 'INFO-000', 'ok', '30', '60'),
           ('pb1', 'L2', 'r', 0, now(), 'INFO-000', 'ok', '25', '70')"""
    )
    args = {"run_id": "r", "batch_ids": ["pb1"], "max_spd": 150}
    for _ in range(2):
        db._run(cur, db.read_sql("ev01/load_obs.sql"), args, False)
    assert rows(cur, "SELECT count(*) AS n FROM core.traffic_obs WHERE poll_batch_id = 'pb1'")[0]["n"] == 2


# 수집 시각 범위 조회는 해당 달 파티션만
def test_range_query_prunes(cur):
    cur.execute("SELECT core.ensure_traffic_obs_partitions(%s::timestamptz, 2)", (OLD,))
    cur.execute(
        """EXPLAIN SELECT * FROM core.traffic_obs
           WHERE collected_at >= '2025-01-10 00:00+09' AND collected_at < '2025-01-11 00:00+09'"""
    )
    plan = "\n".join(r[0] for r in cur.fetchall())
    assert "traffic_obs_202501" in plan and "traffic_obs_202502" not in plan


def _old_obs(cur, link="L9"):
    cur.execute("SELECT core.ensure_traffic_obs_partitions(%s::timestamptz, 1)", (OLD,))
    cur.execute(
        """INSERT INTO core.traffic_obs (link_id, poll_batch_id, collected_at, prcs_spd, prcs_trv_time, run_id)
           VALUES (%s, 'old1', %s, 30, 60, 'r')""",
        (link, OLD),
    )


def _drop(cur, dry_run):
    return db._run(cur, "SELECT * FROM core.drop_expired_traffic_obs_partitions(30, %(d)s)", {"d": dry_run}, True)


# 시간대 미확정·미게시면 보호, 조건 충족 시 dry_run 은 대상만·실행은 삭제, 열린 재처리 요청이면 보호
def test_drop_expired_partition(cur, seed):
    _old_obs(cur)
    assert "traffic_obs_202501" not in {r["partition_name"] for r in _drop(cur, True)}  # 미확정·미게시
    cur.execute(
        """INSERT INTO core.link_timeband (link_id, obs_date, timeband, rep_spd, rep_trv_time, rep_collected_at,
               obs_cnt, is_final) VALUES ('L9', '2025-01-15', 10, 30, 60, %s, 1, true)""",
        (OLD,),
    )
    cur.execute(
        """INSERT INTO ops.publish_log (base_month, run_id, fingerprint, reg_load_id, link_ver, boundary_ver,
               threshold_ver, target_set, traffic_window_start, traffic_window_end, period_mismatch, region_cnt)
           SELECT '202501', 'p_old', 'f', min(load_id), 'lt', 'bt', 'mvp_v3', 't', '2025-01-01+09', '2025-02-01+09',
                  true, 1 FROM ops.reg_load"""
    )
    cur.execute(
        """INSERT INTO ops.reprocess_request (scope, date_from, date_to, reason, status)
           VALUES ('timeband', '2025-01-15', '2025-01-15', 't', 'requested') RETURNING request_id"""
    )
    req = cur.fetchone()[0]
    assert "traffic_obs_202501" not in {r["partition_name"] for r in _drop(cur, True)}  # 열린 요청
    cur.execute("UPDATE ops.reprocess_request SET status = 'done' WHERE request_id = %s", (req,))
    dry = {r["partition_name"]: r["row_cnt"] for r in _drop(cur, True)}
    assert dry.get("traffic_obs_202501") == 1 and "traffic_obs_202501" in _parts(cur)
    _drop(cur, False)
    assert "traffic_obs_202501" not in _parts(cur)


# 데이터 있는 옛 일반 테이블 → 전환: 행 보존, 달마다 파티션, 재실행 안전 (트랜잭션 롤백으로 원복)
def test_migration_from_plain_table(cur):
    cur.execute("DROP TABLE core.traffic_obs CASCADE")
    cur.execute(
        """CREATE TABLE core.traffic_obs (
               link_id text NOT NULL, poll_batch_id text NOT NULL, collected_at timestamptz NOT NULL,
               source_observed_at timestamptz, prcs_spd numeric(6, 1) NOT NULL, prcs_trv_time numeric(8, 1) NOT NULL,
               run_id text NOT NULL, PRIMARY KEY (link_id, poll_batch_id));
           CREATE INDEX traffic_obs_collected_idx ON core.traffic_obs (collected_at);
           INSERT INTO core.traffic_obs VALUES
               ('L1', 'a', '2026-08-31 23:50+09', NULL, 30, 60, 'r'),
               ('L1', 'b', '2026-09-01 00:10+09', NULL, 31, 61, 'r'),
               ('L2', 'c', '2026-10-15 12:00+09', NULL, 32, 62, 'r');"""
    )
    ddl = (db.SQL_DIR / "ddl" / "15_traffic_obs_partition.sql").read_text(encoding="utf-8")
    cur.execute(ddl)
    cur.execute(ddl)  # 재실행
    assert rows(cur, "SELECT relkind FROM pg_class WHERE oid = 'core.traffic_obs'::regclass")[0]["relkind"] == "p"
    got = rows(
        cur, "SELECT tableoid::regclass::text AS part, count(*) AS n FROM core.traffic_obs GROUP BY 1 ORDER BY 1"
    )
    assert [(r["part"], r["n"]) for r in got] == [
        ("core.traffic_obs_202608", 1),
        ("core.traffic_obs_202609", 1),
        ("core.traffic_obs_202610", 1),
    ]
    assert rows(cur, "SELECT to_regclass('core.traffic_obs_old') AS t")[0]["t"] is None
