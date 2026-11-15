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
