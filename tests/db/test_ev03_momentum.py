# 등록 추세 보조: 한 달 몰림(대치2동형)·최근 가속(반포본동형) 플래그, 예측, 이력 부족 동 제외
import statistics

from common import db

from .conftest import _reg_load, _reg_row, rows
from .test_ev03_publish import _resolve

# 202510~202608 중간 월 (seed 가 202509·202609 보유)
MID = ["202510", "202511", "202512", "202601", "202602", "202603", "202604", "202605", "202606", "202607", "202608"]
SERIES = {
    "1168000001": [500, 500, 950, 955, 960, 965, 970, 975, 980, 985, 990],  # 500 → 1000, 12월 한 번에 +450
    "1168000005": [455, 460, 465, 470, 475, 480, 485, 490, 495, 600, 750],  # 450 → 900, 최근 3개월 급증
}


def _months(cur):
    for i, m in enumerate(MID):
        load = _reg_load(cur, m, f"reg_{m}")
        for adm_cd, s in SERIES.items():
            _reg_row(cur, m, adm_cd, "e", s[i], load)


def _run(cur, run_id="g1"):
    args = {**_resolve(cur), "run_id": run_id}
    db._run(cur, db.read_sql("ev03/indicators.sql"), args, False)
    db._run(cur, db.read_sql("ev03/momentum.sql"), args, False)
    return {
        r["adm_cd"]: r for r in rows(cur, "SELECT * FROM mart.candidate_admdong_indicator WHERE run_id = %s", (run_id,))
    }


def test_flags_reproduce_cases(cur, supply):
    _months(cur)
    got = _run(cur)
    a, b = got["1168000001"], got["1168000005"]
    assert a["growth_flags"] == ["concentrated"] and float(a["max_month_share"]) == 90.0
    assert b["growth_flags"] == ["accelerating"] and float(b["rate_3m"]) == round(100 * (900 - 495) / 495, 1)
    # 예측: 최근 6개월 월 증가 중앙값
    full = [450, *SERIES["1168000005"], 900]
    med = statistics.median([full[i] - full[i - 1] for i in range(len(full) - 6, len(full))])
    assert (b["ev_fcst_3m"], b["ev_fcst_6m"]) == (round(900 + 3 * med), round(900 + 6 * med))
    assert a["ev_fcst_3m"] == 1000 + 3 * 5  # 몰림 달(12월)은 최근 6개월 밖


# 13개월 미만 이력: 플래그·예측 없음
def test_short_history(cur, supply):
    got = _run(cur)
    assert all(r["growth_flags"] == [] and r["ev_fcst_3m"] is None for r in got.values())
