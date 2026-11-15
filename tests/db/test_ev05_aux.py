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


