# 커스텀 Hook·Sensor 단위 테스트 (외부 API 호출 없음)
from hooks import seoul_openapi_hook as h
from hooks.data_go_kr_hook import DataGoKrHook, GoKrResult
from sensors.seoul_api_base_month_sensor import SeoulApiBaseMonthSensor

TRAFFIC_OK = b"""<?xml version="1.0" encoding="UTF-8"?><TrafficInfo><list_total_count>1</list_total_count>
<RESULT><CODE>INFO-000</CODE><MESSAGE>ok</MESSAGE></RESULT>
<row><link_id>1220003800</link_id><prcs_spd>19</prcs_spd><prcs_trv_time>568</prcs_trv_time></row></TrafficInfo>"""
NO_DATA = (
    b"""<?xml version="1.0"?><TrafficInfo><RESULT><CODE>INFO-200</CODE><MESSAGE>none</MESSAGE></RESULT></TrafficInfo>"""
)
ERROR = (
    b"""<?xml version="1.0"?><response><RESULT><CODE>ERROR-500</CODE><MESSAGE>server</MESSAGE></RESULT></response>"""
)


# 소문자 응답 필드 대문자 통일, 총건수
def test_parse_ok_uppercases_fields():
    r = h.SeoulOpenApiHook.parse(TRAFFIC_OK)
    assert (r.code, r.total, r.status) == ("INFO-000", 1, "ok")
    assert r.rows[0]["PRCS_SPD"] == "19"


# 무관측과 장애 구분 (커버리지 분모·분자 처리 근거)
def test_status_no_data_vs_error():
    assert h.SeoulOpenApiHook.parse(NO_DATA).status == "no_data"
    assert h.SeoulOpenApiHook.parse(ERROR).status == "api_error"


class _FakeHook:
    def __init__(self, latest):
        self.latest = latest

    def call(self, service, start, end):
        return h.ApiResult(code="INFO-000", total=1, rows=[{"STATS_YM": self.latest}])


# 센서: 원천 최신 기준월 = 대상일 때만 통과, 기본 reschedule
def test_sensor_poke(monkeypatch):
    s = SeoulApiBaseMonthSensor(task_id="t", service="S", api_key_var="k", base_month="202609")
    assert s.mode == "reschedule"
    monkeypatch.setattr("sensors.seoul_api_base_month_sensor.SeoulOpenApiHook", lambda **kw: _FakeHook("202608"))
    assert s.poke({}) is False
    monkeypatch.setattr("sensors.seoul_api_base_month_sensor.SeoulOpenApiHook", lambda **kw: _FakeHook("202609"))
    assert s.poke({}) is True


# 파일 경로는 공표 대기 생략
def test_sensor_file_source_passes():
    s = SeoulApiBaseMonthSensor(task_id="t", service="S", api_key_var="k", base_month="202509", source="file")
    assert s.poke({}) is True


# 공공데이터포털 Hook: 평면 JSON·단건 item·게이트웨이 XML 오류
CHARGER_OK = (
    b'{"resultMsg":"NORMAL SERVICE.","totalCount":2,"pageNo":1,"resultCode":"00","numOfRows":10,'
    b'"items":{"item":[{"statId":"ME000001","chgerId":"01","lat":"37.5","lng":"127.0"},'
    b'{"statId":"ME000001","chgerId":"02","lat":"37.5","lng":"127.0"}]}}'
)
CHARGER_SINGLE = b'{"response":{"header":{"resultCode":"00","resultMsg":"OK"},"body":{"totalCount":1,"items":{"item":{"statId":"A","chgerId":"01"}}}}}'  # noqa: E501
CHARGER_EMPTY = b'{"resultCode":"00","resultMsg":"OK","totalCount":0,"items":""}'
GATEWAY_ERROR = b"""<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>
<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode>
</cmmMsgHeader></OpenAPI_ServiceResponse>"""


def test_go_kr_parse_flat_json():
    r = DataGoKrHook.parse(CHARGER_OK)
    assert (r.ok, r.total, len(r.rows)) == (True, 2, 2)
    assert r.rows[1]["chgerId"] == "02"


def test_go_kr_parse_single_and_empty():
    assert DataGoKrHook.parse(CHARGER_SINGLE).rows == [{"statId": "A", "chgerId": "01"}]
    r = DataGoKrHook.parse(CHARGER_EMPTY)
    assert (r.ok, r.total, r.rows) == (True, 0, [])


def test_go_kr_gateway_error_not_ok():
    r = DataGoKrHook.parse(GATEWAY_ERROR)
    assert (r.ok, r.code) == (False, "30")
    assert "NOT_REGISTERED" in r.message


class _PagedHook(DataGoKrHook):
    def __init__(self, total, page_rows):
        self.total, self.page_rows, self.pages = total, page_rows, []

    def call(self, path, **params):
        self.pages.append(params["pageNo"])
        return GoKrResult(code="00", total=self.total, rows=[{}] * self.page_rows)


# 전수 페이지: totalCount 기준 페이지 수만 호출
def test_go_kr_fetch_all_pages():
    h = _PagedHook(total=25, page_rows=10)
    total, rows = h.fetch_all("x", page_size=10)
    assert (total, len(rows), h.pages) == (25, 30, [1, 2, 3])


class _BoomSession:
    def get(self, url, params=None, timeout=None):
        import requests

        raise requests.ConnectionError(f"{url}?serviceKey={params['serviceKey']}")


class _Res:
    ok, status_code = False, 504


# 호출 오류 메시지에 인증키 미포함 (Task 로그 노출 방지)
def test_go_kr_error_hides_key(monkeypatch):
    import pytest

    hook = DataGoKrHook(api_key_var="k")
    hook._base, hook._key, hook._session = "https://x", "SECRETKEY", _BoomSession()
    monkeypatch.setattr(hook, "get_conn", lambda: hook._base)
    with pytest.raises(RuntimeError) as e:
        hook.call("p", pageNo=1)
    assert "SECRETKEY" not in str(e.value) and e.value.__cause__ is None
    hook._session = type("S", (), {"get": lambda self, *a, **k: _Res()})()
    with pytest.raises(RuntimeError) as e:
        hook.call("p", pageNo=1)
    assert "504" in str(e.value) and "SECRETKEY" not in str(e.value)
