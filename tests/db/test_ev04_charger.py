# ev04 충전기 이력 DB 통합 테스트: 격리·동 귀속·SCD2 반영·같은 날 재실행·시점 조회
import json

from common import db

from .conftest import TARGET_SET, rows

D1, D2 = "2026-11-01", "2026-11-02"
BAD_ROWS = [  # 좌표 오류·키 누락·중복 (3건 격리)
    {"statId": "BAD", "chgerId": "01", "lat": "abc", "lng": "127"},
    {"statId": "", "chgerId": "01", "lat": "37.5", "lng": "127"},
    {"statId": "S0", "chgerId": "01", "lat": "37.5", "lng": "127"},
]


def _points(cur):
    # 테스트 행정동 내부 점 (WGS84)
    return rows(
        cur,
        """SELECT a.sgg_cd, a.adm_cd, ST_X(p) AS lng, ST_Y(p) AS lat FROM core.admdong a,
                  LATERAL ST_Transform(ST_PointOnSurface(a.geom), 4326) p
           WHERE a.boundary_ver = 'bt' ORDER BY a.adm_cd""",
    )


# 동마다 충전소 1곳 × 충전기 2대 (01 급속 DC콤보, 02 완속), mutate 로 일자별 변경
def _raw(cur, run_id, pts, mutate=lambda i, r: r):
    items = []
    for i, p in enumerate(pts):
        for c, t, kw in (("01", "04", "100"), ("02", "02", "7")):
            r = mutate(i, {"statId": f"S{i}", "chgerId": c, "statNm": f"충전소{i}", "chgerType": t, "output": kw,
                           "lat": str(p["lat"]), "lng": str(p["lng"]), "delYn": "N"})  # fmt: skip
            if r is not None:
                items.append((p["sgg_cd"], r))
    items += [(pts[0]["sgg_cd"], r) for r in BAD_ROWS]
    cur.executemany(
        "INSERT INTO staging.charger_raw (run_id, sgg_cd, row_no, payload) VALUES (%s, %s, %s, %s)",
        [(run_id, sgg, i, json.dumps(r, ensure_ascii=False)) for i, (sgg, r) in enumerate(items, 1)],
    )


# DAG 순서대로 실행 (격리 → 정제·귀속 → 지표 → 비교 → 적재 이력 + 반영)
def _day(cur, run_id, date, sggs, pts, mutate=lambda i, r: r):
    _raw(cur, run_id, pts, mutate)
    db._run(cur, db.read_sql("ev04/quarantine.sql"), {"run_id": run_id}, False)
    db._run(cur, db.read_sql("ev04/normalize.sql"), {"run_id": run_id}, False)
    gate = db._run(cur, db.read_sql("ev04/gate_metrics.sql"), {"run_id": run_id}, True)[0]
    diff = db._run(cur, db.read_sql("ev04/diff.sql"), {"run_id": run_id, "snapshot_date": date, "sgg_cds": sggs}, True)
    tot = {k: sum(r[k] for r in diff) for k in ("prev_cnt", "cur_cnt", "new_cnt", "changed_cnt", "closed_cnt")}
    p = {"run_id": run_id, "snapshot_date": date, "sgg_cds": sggs, "row_cnt": tot["cur_cnt"], "quality_grade": "ok",
         **tot}  # fmt: skip
    load = db._run(cur, db.read_sql("ev04/load_log.sql"), p, True)[0]
    db._run(cur, db.read_sql("ev04/apply_scd.sql"), {**p, **load}, False)
    return gate, tot


def _counts(cur):
    return rows(
        cur,
        """SELECT count(*) FILTER (WHERE valid_to IS NULL) AS open, count(*) AS total,
                  count(*) FILTER (WHERE valid_to IS NULL AND is_fast) AS fast FROM core.charger""",
    )[0]


# 2일차 변경: 0번 출력 변경, 1번 01 삭제 표시, 2번 02 응답에서 사라짐
def _day2(i, r):
    if i == 0 and r["chgerId"] == "01":
        r["output"] = "200"
    if i == 1 and r["chgerId"] == "01":
        r["delYn"] = "Y"
    if i == 2 and r["chgerId"] == "02":
        return None
    return r


def _setup(cur):
    sggs = [r["sgg_cd"] for r in db._run(cur, db.read_sql("ev04/target_sgg.sql"), {"target_set": TARGET_SET}, True)]
    return sggs, _points(cur)


# 대상 구·격리 사유·동 귀속·급속 판정
def test_quarantine_and_assign(cur, seed):
    sggs, pts = _setup(cur)
    assert sggs == ["11680"]
    gate, tot = _day(cur, "c1", D1, sggs, pts)
    n = len(pts) * 2
    assert (gate["raw_rows"], gate["quarantine_rows"], gate["norm_rows"]) == (n + 3, 3, n)
    assert gate["assigned_rows"] == n and gate["sgg_mismatch_rows"] == 0 and gate["unknown_type_rows"] == 0
    reasons = {r["reason_code"] for r in rows(cur, "SELECT reason_code FROM quarantine.charger_record")}
    assert reasons == {"missing_key", "duplicate_key", "invalid_coord"}
    assigned = rows(cur, "SELECT stat_id, adm_cd FROM core.charger WHERE chger_id = '01' ORDER BY stat_id")
    assert [r["adm_cd"] for r in assigned] == [p["adm_cd"] for p in pts]
    assert tot["new_cnt"] == n and _counts(cur) == {"open": n, "total": n, "fast": len(pts)}


# 이력: 변경은 버전 추가, 삭제 표시·소멸은 종료, 시점 조회는 전날 상태
def test_scd_history(cur, seed):
    sggs, pts = _setup(cur)
    n = len(pts) * 2
    _day(cur, "c1", D1, sggs, pts)
    _, tot = _day(cur, "c2", D2, sggs, pts, _day2)
    assert (tot["prev_cnt"], tot["new_cnt"], tot["changed_cnt"], tot["closed_cnt"]) == (n, 0, 1, 2)
    assert _counts(cur) == {"open": n - 2, "total": n + 1, "fast": len(pts) - 1}
    ver = rows(cur, "SELECT output_kw, valid_from, valid_to FROM core.charger WHERE stat_id = 'S0' AND chger_id = '01'"
               " ORDER BY valid_from")  # fmt: skip
    assert [(float(v["output_kw"]), str(v["valid_from"]), v["valid_to"] and str(v["valid_to"])) for v in ver] == [
        (100.0, D1, D2),
        (200.0, D2, None),
    ]
    asof = rows(
        cur,
        "SELECT count(*) AS n FROM core.charger WHERE valid_from <= %(d)s AND (valid_to IS NULL OR valid_to > %(d)s)",
        {"d": D1},
    )[0]["n"]
    assert asof == n


# 같은 날 재실행: 같은 입력이면 결과 동일, 다른 입력이면 그날 반영분 대체
def test_same_day_rerun(cur, seed):
    sggs, pts = _setup(cur)
    n = len(pts) * 2
    _day(cur, "c1", D1, sggs, pts)
    _, t2 = _day(cur, "c2", D2, sggs, pts, _day2)
    after = _counts(cur)
    _, t3 = _day(cur, "c3", D2, sggs, pts, _day2)
    assert t3 == t2 and _counts(cur) == after
    _, t4 = _day(cur, "c4", D2, sggs, pts)  # 전날과 같은 입력으로 재실행
    assert (t4["changed_cnt"], t4["closed_cnt"]) == (0, 0)
    assert _counts(cur) == {"open": n, "total": n, "fast": len(pts)}


# 급속: 출력 기준 (출력 없으면 타입), 좌표가 다른 구면 sgg_mismatch
def test_fast_by_output_and_sgg_mismatch(cur, seed):
    _, pts = _setup(cur)
    p = pts[0]
    base = {"statNm": "x", "lat": str(p["lat"]), "lng": str(p["lng"]), "delYn": "N"}
    items = [
        ("11680", {**base, "statId": "F1", "chgerId": "01", "chgerType": "07", "output": "7"}),  # AC3상 7kW → 완속
        ("11680", {**base, "statId": "F2", "chgerId": "01", "chgerType": "11", "output": "120"}),  # 미등록 타입 → 출력
        ("11680", {**base, "statId": "F3", "chgerId": "01", "chgerType": "04", "output": ""}),  # 출력 없음 → 타입
        ("11650", {**base, "statId": "M1", "chgerId": "01", "chgerType": "02", "output": "7"}),  # 요청 구 ≠ 좌표 구
    ]
    cur.executemany(
        "INSERT INTO staging.charger_raw (run_id, sgg_cd, row_no, payload) VALUES ('f1', %s, %s, %s)",
        [(sgg, i, json.dumps(r)) for i, (sgg, r) in enumerate(items, 1)],
    )
    db._run(cur, db.read_sql("ev04/normalize.sql"), {"run_id": "f1"}, False)
    got = {
        r["stat_id"]: (r["is_fast"], r["assign_status"])
        for r in rows(cur, "SELECT stat_id, is_fast, assign_status FROM staging.charger_norm WHERE run_id = 'f1'")
    }
    assert got == {
        "F1": (False, "assigned"),
        "F2": (True, "assigned"),
        "F3": (True, "assigned"),
        "M1": (False, "sgg_mismatch"),
    }
    gate = db._run(cur, db.read_sql("ev04/gate_metrics.sql"), {"run_id": "f1"}, True)[0]
    assert (gate["assigned_rows"], gate["sgg_mismatch_rows"], gate["unknown_type_rows"]) == (3, 1, 0)
