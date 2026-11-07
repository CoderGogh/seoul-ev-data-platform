# 수집 오류율 등급·호출 한도 판정 (ev01 상태 확정, ev12 리포트 공통)

# 오류율 = (API 오류 + 미응답) / 대상 링크. 잠정 기준, 분포 누적 후 재조정
WARN_ERROR_RATE = 0.01  # 초과 경고 (링크 9개 이상)
FATAL_ERROR_RATE = 0.20  # 초과 치명 (묶음 2개 이상 실패 수준)
LIMIT_WARN_RATIO = 0.9  # 일 호출량 / 한도, 이상이면 임박 경고


# 회차 커버리지 → 오류율
def error_rate(cov):
    if not cov or not cov["target_cnt"]:
        return 1.0
    answered = cov["ok_cnt"] + cov["no_data_cnt"] + cov["invalid_cnt"]
    return round(max(cov["target_cnt"] - answered, 0) / cov["target_cnt"], 4)


# 오류율 등급 (ok / warn / fatal)
def grade_error_rate(rate):
    if rate > FATAL_ERROR_RATE:
        return "fatal"
    return "warn" if rate > WARN_ERROR_RATE else "ok"


# 호출 한도 등급: 한도 오류 발생 = 치명, 한도 설정 시 임박 = 경고
def grade_limit(limit_errors, daily_calls, daily_limit=None):
    if limit_errors:
        return "fatal"
    if daily_limit and daily_calls >= daily_limit * LIMIT_WARN_RATIO:
        return "warn"
    return "ok"
