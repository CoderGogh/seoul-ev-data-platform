# 분포 급변 판정 단위 테스트: PSI·분류 변경 비율·A 수 변화
import random

from common import drift as d


def _rows(classes, base=0.0, n=67):
    rnd = random.Random(7)
    return [
        {"adm_cd": f"{i:010d}", "classification": classes[i % len(classes)],
         **{c: rnd.gauss(base, 1) for c in d.INDICATORS}}
        for i in range(n)
    ]  # fmt: skip


# 같은 분포 0, 크게 이동하면 경고 기준 초과, 표본 부족·결측은 생략
def test_psi():
    rnd = random.Random(1)
    a = [rnd.gauss(0, 1) for _ in range(67)]
    assert d.psi(a, a) == 0
    assert d.psi(a, [v + 2 for v in a]) > d.PSI_WARN
    assert d.psi(a[:10], a) is None and d.psi([None] * 67, a) is None


def test_flip_ratio():
    assert d.flip_ratio({"1": "A", "2": "REF"}, {"1": "REF", "2": "REF", "3": "A"}) == 0.5
    assert d.flip_ratio({}, {"1": "A"}) is None


# 직전 게시 없으면 검사 없음
def test_evaluate_no_baseline():
    assert d.evaluate([], _rows(["A"])) == []


# 동일 결과는 전부 ok, 이동·분류 변경·A 급증은 경고
def test_evaluate_grades():
    prev = _rows(["REF"] * 9 + ["A"])
    assert all(c["grade"] == "ok" for c in d.evaluate(prev, prev))
    cur = [{**r, "ev_cnt": r["ev_cnt"] + 3, "classification": "A" if i % 3 == 0 else "REF"} for i, r in enumerate(prev)]
    got = {c["name"]: c["grade"] for c in d.evaluate(prev, cur)}
    assert got["drift_psi_ev_cnt"] == "warn" and got["drift_psi_speed_cv"] == "ok"
    assert got["drift_class_flip"] == "warn" and got["drift_a_count"] == "warn"


# A 수가 작을 때 절대 차이 1은 비율이 커도 ok
def test_a_count_min_abs():
    prev = _rows(["A"] + ["REF"] * 66)  # A 1개 → 0개: 변화율 100%, 차이 1
    cur = [{**r, "classification": "REF"} for r in prev]
    a = next(c for c in d.evaluate(prev, cur) if c["name"] == "drift_a_count")
    assert a["detail"] == {"prev": 1, "cur": 0} and a["metric"] == 1.0 and a["grade"] == "ok"
