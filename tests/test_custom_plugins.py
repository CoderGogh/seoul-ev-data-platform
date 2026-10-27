# 커스텀 Hook·Sensor 단위 테스트 (외부 API 호출 없음)
from hooks import seoul_openapi_hook as h
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
