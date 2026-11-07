# 직전 게시 대비 분포 급변 판정 (ev03 verify_candidate). 경고만, 치명 기준은 분포 누적 후
import math
from bisect import bisect_right

INDICATORS = ("ev_cnt", "ev_yoy_rate", "speed_cv", "ev_per_charger")
PSI_BINS = 4  # 직전 분포 분위 구간 (67개 동 기준 구간당 약 17개)
PSI_MIN_N = 20  # 표본 부족 시 PSI 생략
PSI_WARN = 0.5  # 67개 동 무변화 모의실험 p99 0.36, 0.8σ 이동 중앙값 0.56 (관례 0.25는 표본 적어 과민)
FLIP_WARN = 0.20  # 분류 바뀐 동 비율
A_CHANGE_WARN = 0.50  # 우선 검토(A) 수 변화율
A_CHANGE_MIN = 2  # 변화율 판정 최소 절대 차이 (A 수가 작아 비율만으론 과민)
EPS = 1e-4  # 빈 구간 보정


# PSI: 직전 분위 구간 기준 비율 차이
def psi(prev, cur, bins=PSI_BINS):
    prev, cur = sorted(float(v) for v in prev if v is not None), [float(v) for v in cur if v is not None]
    if min(len(prev), len(cur)) < PSI_MIN_N:
        return None
    edges = sorted({prev[int(len(prev) * k / bins)] for k in range(1, bins)})

    def share(vals):
        cnt = [0] * (len(edges) + 1)
        for v in vals:
            cnt[bisect_right(edges, v)] += 1
        return [max(c / len(vals), EPS) for c in cnt]

    return round(sum((c - p) * math.log(c / p) for p, c in zip(share(prev), share(cur))), 4)


# 분류 바뀐 동 비율 (양쪽에 있는 동만)
def flip_ratio(prev, cur):
    common = prev.keys() & cur.keys()
    if not common:
        return None
    return round(sum(1 for k in common if prev[k] != cur[k]) / len(common), 4)


def _classes(rows):
    return {r["adm_cd"]: r["classification"] for r in rows}


# 검사 목록: name·metric·threshold·grade
def evaluate(prev_rows, cur_rows):
    if not prev_rows:
        return []
    checks = []
    for col in INDICATORS:
        m = psi([r[col] for r in prev_rows], [r[col] for r in cur_rows])
        checks.append({"name": f"drift_psi_{col}", "metric": m, "threshold": PSI_WARN,
                       "grade": "warn" if m is not None and m > PSI_WARN else "ok"})  # fmt: skip
    f = flip_ratio(_classes(prev_rows), _classes(cur_rows))
    checks.append({"name": "drift_class_flip", "metric": f, "threshold": FLIP_WARN,
                   "grade": "warn" if f is not None and f > FLIP_WARN else "ok"})  # fmt: skip
    a_prev = sum(1 for r in prev_rows if r["classification"] == "A")
    a_cur = sum(1 for r in cur_rows if r["classification"] == "A")
    rate = abs(a_cur - a_prev) / a_prev if a_prev else (1.0 if a_cur else 0.0)
    over = rate > A_CHANGE_WARN and abs(a_cur - a_prev) >= A_CHANGE_MIN
    checks.append({"name": "drift_a_count", "metric": round(rate, 4), "threshold": A_CHANGE_WARN,
                   "grade": "warn" if over else "ok", "detail": {"prev": a_prev, "cur": a_cur}})  # fmt: skip
    return checks
