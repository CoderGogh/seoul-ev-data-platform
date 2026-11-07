# 수집 오류율 등급·호출 한도 판정 단위 테스트
from common import api_usage as u
from hooks import seoul_openapi_hook as h

LIMIT_XML = (
    b"""<?xml version="1.0"?><response><RESULT><CODE>ERROR-337</CODE><MESSAGE>limit</MESSAGE></RESULT></response>"""
)


def _cov(ok, no_data=0, invalid=0, target=914):
    return {"target_cnt": target, "ok_cnt": ok, "no_data_cnt": no_data, "invalid_cnt": invalid}


# 오류율 = (API 오류 + 미응답) / 대상, 무관측·격리는 응답으로 인정
def test_error_rate():
    assert u.error_rate(_cov(900, 10, 4)) == 0
    assert u.error_rate(_cov(814)) == round(100 / 914, 4)  # 묶음 1개 실패
    assert u.error_rate(None) == 1.0 and u.error_rate(_cov(0, target=0)) == 1.0


# 등급 경계: 1% 이하 ok, 20% 이하 warn, 초과 fatal
def test_grade_error_rate():
    assert [u.grade_error_rate(r) for r in (0, 0.01, 0.0101, 0.2, 0.21)] == ["ok", "ok", "warn", "warn", "fatal"]


# 한도: 한도 오류 = 치명, 한도 설정 시 90% 이상 경고, 미설정이면 오류만 감시
def test_grade_limit():
    assert u.grade_limit(1, 0) == "fatal"
    assert u.grade_limit(0, 44_000) == "ok"
    assert u.grade_limit(0, 45_000, 50_000) == "warn"
    assert u.grade_limit(0, 44_000, 50_000) == "ok"


# 한도 초과 응답 판별 (재시도 없이 실패하는 근거)
def test_limit_code():
    r = h.SeoulOpenApiHook.parse(LIMIT_XML)
    assert r.status == "api_error" and r.is_limit
    assert not h.ApiResult(code="ERROR-500").is_limit
