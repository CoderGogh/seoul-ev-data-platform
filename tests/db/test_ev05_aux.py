# ev05 수요 보조 DB 통합 테스트: 격리·위치 판정(좌표 미보관)·정제·게이트 지표·스냅샷 교체·ev03 참고 지표
import json

from common import db, locate

from .conftest import TARGET_SET, WINDOW, rows

D1 = "2026-11-16"
SGG_NM = "테스트구"


def _points(cur):
    # 테스트 행정동 내부 점 (WGS84)
    return rows(
        cur,
        """SELECT a.adm_cd, ST_X(p) AS lng, ST_Y(p) AS lat FROM core.admdong a,
                  LATERAL ST_Transform(ST_PointOnSurface(a.geom), 4326) p
           WHERE a.boundary_ver = 'bt' ORDER BY a.adm_cd""",
    )


def _apt(code, hh, road):
    return {"kaptCode": code, "kaptName": f"단지{code}", "kaptdaCnt": hh, "doroJuso": road, "bjdCode": "1168010100",
            "kaptDongCnt": "2", "codeAptNm": "아파트", "kaptUsedate": "20051108",
            "kaptAddr": f"서울특별시 테스트구 가동 {hh} 단지{code}"}  # fmt: skip


# 단지 3곳(동1·동5·위치 없음) + 격리 3건(기본 정보 없음·세대수 오류·중복), 주차장 2곳 + 다른 구 1곳 + 격리 1건
def _raw(cur, run_id, pts, hh0=100):
    apts = [
        ({"kaptCode": "A0"}, _apt("A0", hh0, "서울특별시 테스트구 일로 1")),
        ({"kaptCode": "A1"}, _apt("A1", 50, "서울특별시 테스트구 오로 5")),
        ({"kaptCode": "A2"}, _apt("A2", 30, "서울특별시 테스트구 없는로 9")),
        ({"kaptCode": "B0"}, None),
        ({"kaptCode": "B1"}, {**_apt("B1", 0, "x"), "kaptdaCnt": None}),
        ({"kaptCode": "A1"}, _apt("A1", 50, "서울특별시 테스트구 오로 5")),
    ]
    cur.executemany(
        "INSERT INTO staging.apt_raw (run_id, sgg_cd, row_no, list_payload, basis_payload) VALUES (%s, %s, %s, %s, %s)",
        [(run_id, "11680", i, json.dumps(it, ensure_ascii=False), json.dumps(b, ensure_ascii=False) if b else None)
         for i, (it, b) in enumerate(apts, 1)],
    )  # fmt: skip
    p0 = pts[0]
    park = [  # 노상 구획 2행(원천 좌표), 노외 30면(좌표 0 → 지오코딩), 다른 구, 코드 누락
        {"PKLT_CD": "P1", "PKLT_NM": "노상", "ADDR": f"{SGG_NM} 가동 1-0", "TPKCT": "1", "LAT": str(p0["lat"]),
         "LOT": str(p0["lng"]), "PKLT_KND_NM": "노상 주차장"},
        {"PKLT_CD": "P1", "PKLT_NM": "노상", "ADDR": f"{SGG_NM} 가동 1-0", "TPKCT": "1", "LAT": str(p0["lat"]),
         "LOT": str(p0["lng"]), "PKLT_KND_NM": "노상 주차장"},
        {"PKLT_CD": "P2", "PKLT_NM": "노외", "ADDR": f"{SGG_NM} 마동 5-0", "TPKCT": "30", "LAT": "0", "LOT": "0",
         "PKLT_KND_NM": "노외 주차장"},
        {"PKLT_CD": "P9", "PKLT_NM": "다른구", "ADDR": "중구 을지로3가 1", "TPKCT": "10", "LAT": "0", "LOT": "0"},
        {"PKLT_CD": "", "PKLT_NM": "코드없음", "ADDR": f"{SGG_NM} 가동 2", "TPKCT": "3", "LAT": "0", "LOT": "0"},
    ]  # fmt: skip
    cur.executemany(
        "INSERT INTO staging.parking_raw (run_id, row_no, payload) VALUES (%s, %s, %s)",
        [(run_id, i, json.dumps(r, ensure_ascii=False)) for i, r in enumerate(park, 1)],
    )


# DAG 순서대로 실행 (격리 → 위치 판정 → 정제 → 게이트 지표 → 적재 이력 + 스냅샷)
def _run(cur, run_id, date, hh0=100):
    pts = _points(cur)
    by_addr = {
        ("road", "서울특별시 테스트구 일로 1"): pts[0], ("road", "서울특별시 테스트구 오로 5"): pts[4],
        ("parcel", "서울특별시 테스트구 마동 5"): pts[4],
    }  # fmt: skip
    _raw(cur, run_id, pts, hh0)
    sgg = {"run_id": run_id, "sgg_nms": [SGG_NM]}
    db._run(cur, db.read_sql("ev05/quarantine.sql"), sgg, False)
    targets = db._run(cur, db.read_sql("ev05/locate_targets.sql"), sgg, True)
    calls = []

    def geocode(addr, addr_type):
        calls.append(addr)
        p = by_addr.get((addr_type, addr))
        return (p["lng"], p["lat"]) if p else None

    points, _ = locate.locate_all(targets, geocode)
    db._run(cur, db.read_sql("ev05/assign_points.sql"), {"run_id": run_id, "points": json.dumps(points)}, False)
    db._run(cur, db.read_sql("ev05/normalize.sql"), {"run_id": run_id, "sgg_map": json.dumps({SGG_NM: "11680"})}, False)
    gate = db._run(cur, db.read_sql("ev05/gate_metrics.sql"), {"run_id": run_id, "snapshot_date": date}, True)[0]
    p = {"run_id": run_id, "snapshot_date": date, "sgg_cds": ["11680"], "quality_grade": "ok"}
    load = db._run(cur, db.read_sql("ev05/load_log.sql"), p, True)[0]
    db._run(cur, db.read_sql("ev05/apply_snapshot.sql"), {**p, **load}, False)
    return targets, gate, load, calls


def test_quarantine_locate_normalize(cur, seed):
    targets, gate, load, calls = _run(cur, "r1", D1)
    q = {(r["src"], r["reason_code"]) for r in rows(cur, "SELECT src, reason_code FROM quarantine.aux_record")}
    assert q == {("apt", "missing_basis"), ("apt", "invalid_hh"), ("apt", "duplicate_key"), ("parking", "missing_key")}
    # 주차장 원천 좌표는 구획 평균, 다른 구 제외
    t = {r["src_key"]: r for r in targets}
    assert set(t) == {"A0", "A1", "A2", "P1", "P2"} and t["P1"]["lng"] is not None and t["P2"]["lng"] is None
    assert "서울특별시 테스트구 마동 5" in calls  # 부번 0 제거한 지번
    apt = {r["kapt_code"]: r for r in rows(cur, "SELECT * FROM staging.apt_norm WHERE run_id = 'r1'")}
    assert (apt["A0"]["adm_cd"], apt["A0"]["loc_source"], apt["A0"]["assign_status"]) == (
        "1168000001", "geocoded_road", "assigned")  # fmt: skip
    assert apt["A1"]["adm_cd"] == "1168000005" and apt["A0"]["use_date"].isoformat() == "2005-11-08"
    assert (apt["A2"]["assign_status"], apt["A2"]["loc_source"]) == ("unlocated", "none")
