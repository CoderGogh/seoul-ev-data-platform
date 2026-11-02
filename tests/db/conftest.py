# DB 통합 테스트 공통: 테스트 전용 DB 연결, 테스트마다 롤백, 최소 마스터·관측·등록 데이터
# EV_TEST_DB_URL 없으면 전체 건너뜀 (DDL 적용된 빈 DB 필요)
import os

import pytest

psycopg = pytest.importorskip("psycopg")

DB_URL = os.environ.get("EV_TEST_DB_URL")

TARGET_SET = "ts_test"
BASE_MONTH, PREV_MONTH = "202609", "202509"
WINDOW = {"window_start": "2026-10-27T07:00:00+09:00", "window_end": "2026-10-27T22:00:00+09:00"}
OBS_DATE = "2026-10-27"
HOURS = range(7, 22)  # 주간 15개 시간대

# 행정동: (코드, 이름, 링크 수, 관측 시간대, 대표 속도, 전기차 당월, 전년)
DONGS = [
    ("1168000001", "가동", 3, HOURS, 10, 1000, 500),  # 규모·증가 기준 이상, 혼잡 → A
    ("1168000002", "나동", 3, HOURS, 30, 100, 90),  # 기준 미만 → REF
    ("1168000003", "다동", 3, range(7, 9), 30, 800, 400),  # 관측 부족 → C
    ("1168000004", "라동", 0, (), None, 50, 40),  # 링크 없음 → WITHHELD
    ("1168000005", "마동", 3, HOURS, 30, 900, 450),  # 수요 기준 이상, 공급 충분 → REF (v3)
]
EXPECTED_CLASS = {
    "1168000001": "A",
    "1168000002": "REF",
    "1168000003": "C",
    "1168000004": "WITHHELD",
    "1168000005": "REF",
}
CHARGER_DATE = "2026-11-02"
# 충전기: (행정동, 승용 대수, 급속 대수, 버스전용 대수) → 가동 1000/10 = 100 (부족), 마동 900/500 = 1.8 (충분)
SUPPLY = [("1168000001", 10, 2, 5), ("1168000005", 500, 50, 0)]


@pytest.fixture
def cur():
    if not DB_URL:
        pytest.skip("EV_TEST_DB_URL 미설정")
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as c:
            yield c
        conn.rollback()  # 테스트 데이터 폐기


def rows(cur, sql, params=None):
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _reg_load(cur, base_month, run_id):
    cur.execute(
        """INSERT INTO ops.reg_load (base_month, source, run_id, row_cnt, content_hash, quality_grade)
           VALUES (%s, 'api', %s, 0, md5(%s), 'ok') RETURNING load_id""",
        (base_month, run_id, run_id),
    )
    return cur.fetchone()[0]


def _reg_row(cur, base_month, adm_cd, fuel_cd, cnt, load_id):
    cur.execute(
        """INSERT INTO core.reg_snapshot (base_month, adm_cd, fuel_cd, gov_car, gov_van, gov_truck, gov_special,
               pvt_car, pvt_van, pvt_truck, pvt_special, biz_car, biz_van, biz_truck, biz_special, total_cnt, load_id)
           VALUES (%s, %s, %s, 0, 0, 0, 0, %s, 0, 0, 0, 0, 0, 0, 0, %s, %s)""",
        (base_month, adm_cd, fuel_cd, cnt, cnt, load_id),
    )


@pytest.fixture
def seed(cur):
    # 기존 활성 버전 해제 (빈 DB 가정이지만 방어)
    cur.execute("UPDATE core.master_version SET status = 'retired' WHERE status = 'active'")
    cur.execute(
        """INSERT INTO core.master_version (master_type, version, status) VALUES
           ('boundary', 'bt', 'active'), ('link', 'lt', 'active')"""
    )
    for i, (adm_cd, nm, n_links, hours, spd, ev, ev_prev) in enumerate(DONGS):
        x0, y0 = 200000 + i * 1000, 550000
        cur.execute(
            """INSERT INTO core.admdong (boundary_ver, adm_cd, adm_nm, sgg_cd, sgg_nm, geom)
               VALUES ('bt', %s, %s, '11680', '테스트구', ST_Multi(ST_MakeEnvelope(%s, %s, %s, %s, 5186)))""",
            (adm_cd, nm, x0, y0, x0 + 1000, y0 + 1000),
        )
        for k in range(n_links):
            link_id = f"{adm_cd}{k}"
            cur.execute(
                """INSERT INTO core.service_link (link_ver, service_link_id, std_cnt, std_hit, length_m, gap_len_m,
                       geom, mid)
                   VALUES ('lt', %(id)s, 1, 1, 100, 0,
                           ST_MakeLine(ST_Point(%(x)s, %(y)s, 5186), ST_Point(%(x)s + 100, %(y)s, 5186)),
                           ST_Point(%(x)s + 50, %(y)s, 5186))""",
                {"id": link_id, "x": x0 + 100, "y": y0 + 100 + k * 100},
            )
            cur.execute(
                """INSERT INTO core.target_link (target_set, service_link_id, adm_cd, link_ver, boundary_ver)
                   VALUES (%s, %s, %s, 'lt', 'bt')""",
                (TARGET_SET, link_id, adm_cd),
            )
            for h in hours:
                cur.execute(
                    """INSERT INTO core.link_timeband (link_id, obs_date, timeband, rep_spd, rep_trv_time,
                           rep_collected_at, obs_cnt, is_final)
                       VALUES (%s, %s, %s, %s, 60, now(), 2, true)""",
                    (link_id, OBS_DATE, h, spd),
                )
    loads = {m: _reg_load(cur, m, f"reg_{m}") for m in (BASE_MONTH, PREV_MONTH)}
    for adm_cd, _, _, _, _, ev, ev_prev in DONGS:
        for m, cnt in ((BASE_MONTH, ev), (PREV_MONTH, ev_prev)):
            _reg_row(cur, m, adm_cd, "e", cnt, loads[m])
            _reg_row(cur, m, adm_cd, "a", cnt * 10, loads[m])
    return loads


# 충전기 이력 (공급 기준일 = 첫 스냅샷, 기준월 말일보다 늦음)
@pytest.fixture
def supply(cur, seed):
    rows = []
    for adm_cd, n, fast, bus in SUPPLY:
        for k in range(n + bus):
            is_bus = k >= n
            rows.append((f"P{adm_cd[-1]}", f"{k:04d}", adm_cd, "11" if is_bus else ("04" if k < fast else "02"),
                         is_bus or k < fast, "N" if k % 2 else "Y"))  # fmt: skip
    cur.executemany(
        """INSERT INTO core.charger (stat_id, chger_id, valid_from, sgg_cd, chger_type, is_fast, limit_yn, geom,
               boundary_ver, adm_cd, assign_status, attr_hash, load_id)
           SELECT %s, %s, %s, '11680', %s, %s, %s, ST_PointOnSurface(a.geom), 'bt', a.adm_cd, 'assigned', 'h', 1
           FROM core.admdong a WHERE a.boundary_ver = 'bt' AND a.adm_cd = %s""",
        [(s, c, CHARGER_DATE, t, f, lim, adm) for s, c, adm, t, f, lim in rows],
    )
    return rows
