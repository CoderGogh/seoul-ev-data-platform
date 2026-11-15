# 수요 보조(ev05) 단위 테스트: 주소 정리·위치 판정 순서·지오코더 Hook·단건 조회 파싱 (외부 호출 없음)
import pytest
import requests
from common import locate
from hooks.data_go_kr_hook import DataGoKrHook
from hooks.vworld_hook import VWorldGeocoderHook

BASIS_OK = (
    b'{"response":{"body":{"item":{"kaptCode":"A1","kaptdaCnt":93.0,"doroJuso":"x"}},'
    b'"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."}}}'
)
LIST_OK = (
    b'{"response":{"body":{"items":[{"kaptCode":"A1"},{"kaptCode":"A2"}],"numOfRows":2,"pageNo":1,"totalCount":2},'
    b'"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."}}}'
)
GEO_OK = b'{"response":{"status":"OK","result":{"crs":"EPSG:4326","point":{"x":"127.03","y":"37.49"}}}}'
GEO_NONE = b'{"response":{"status":"NOT_FOUND"}}'
GEO_ERR = b'{"response":{"status":"ERROR","error":{"level":"2","code":"INVALID_KEY","text":"SECRETKEY invalid"}}}'


# 단건 조회 body.item, 목록 body.items 배열
def test_go_kr_parse_basis_item_and_list():
    r = DataGoKrHook.parse(BASIS_OK)
    assert r.ok and r.rows == [{"kaptCode": "A1", "kaptdaCnt": 93.0, "doroJuso": "x"}]
    r = DataGoKrHook.parse(LIST_OK)
    assert (r.total, [x["kaptCode"] for x in r.rows]) == (2, ["A1", "A2"])


@pytest.mark.parametrize(
    "addr, expected",
    [
        ("서울특별시 강남구 역삼동 795-41 역삼동월드메르디앙아파트", "서울특별시 강남구 역삼동 795-41"),
        ("강남구 압구정동 428-0", "서울특별시 강남구 압구정동 428"),
        ("서울시 송파구 잠실동 27", "서울특별시 송파구 잠실동 27"),
        ("서울특별시 서초구 내곡동 산 12-3 단지", "서울특별시 서초구 내곡동 산12-3"),
        ("서울특별시 강남구 역삼동", None),
        ("", None),
    ],
)
def test_parcel_address(addr, expected):
    assert locate.parcel_address(addr) == expected


def test_road_address():
    assert locate.road_address(" 강남구 도곡로21길 15 ") == "서울특별시 강남구 도곡로21길 15"
    assert locate.road_address("서울특별시 강남구 도곡로21길 15") == "서울특별시 강남구 도곡로21길 15"
    assert locate.road_address("  ") is None


# 원천 좌표 우선 → 도로명 → 지번, 같은 주소는 실행 안에서 1회 호출
def test_locate_all_order_and_memo():
    found = {
        ("road", "서울특별시 강남구 도곡로21길 15"): (127.0, 37.5),
        ("parcel", "서울특별시 강남구 압구정동 428"): (127.1, 37.6),
    }
    calls = []

    def geocode(addr, addr_type):
        calls.append((addr_type, addr))
        return found.get((addr_type, addr))

    targets = [
        {"src": "parking", "src_key": "P1", "lng": 127.2, "lat": 37.4, "parcel_addr": "강남구 압구정동 428-0"},
        {"src": "apt", "src_key": "A1", "lng": None, "road_addr": "서울특별시 강남구 도곡로21길 15",
         "parcel_addr": "서울특별시 강남구 역삼동 795-41 단지"},
        {"src": "apt", "src_key": "A2", "lng": None, "road_addr": "서울특별시 강남구 없는로 1",
         "parcel_addr": "서울특별시 강남구 압구정동 428 단지"},
        {"src": "parking", "src_key": "P2", "lng": None, "parcel_addr": "강남구 압구정동 428-0"},
        {"src": "apt", "src_key": "A3", "lng": None, "road_addr": None, "parcel_addr": None},
    ]  # fmt: skip
    points, n = locate.locate_all(targets, geocode)
    src = {p["src_key"]: p["loc_source"] for p in points}
    assert src == {"P1": "source_coord", "A1": "geocoded_road", "A2": "geocoded_parcel", "P2": "geocoded_parcel",
                   "A3": "none"}  # fmt: skip
    assert points[0]["lng"] == 127.2 and points[4]["lng"] is None
    assert n == len(calls) == 3  # P2 지번은 A2 결과 재사용


def test_vworld_parse():
    r = VWorldGeocoderHook.parse(GEO_OK)
    assert r.found and (r.lng, r.lat) == (127.03, 37.49)
    assert not VWorldGeocoderHook.parse(GEO_NONE).found
    r = VWorldGeocoderHook.parse(GEO_ERR)
    assert (r.status, r.error_code) == ("ERROR", "INVALID_KEY")


class _Res:
    def __init__(self, content, ok=True, status_code=200):
        self.content, self.ok, self.status_code = content, ok, status_code


def _hook(session):
    hook = VWorldGeocoderHook(min_interval=0)
    hook._base, hook._key, hook._session = "https://x/req/address", "SECRETKEY", session
    return hook


# 결과 없음은 정상, 오류는 코드만 (응답 문구·URL·인증키 미포함)
def test_vworld_geocode_errors_hide_key():
    ok = type("S", (), {"get": lambda self, *a, **k: _Res(GEO_NONE)})()
    assert _hook(ok).geocode("a", "road").status == "NOT_FOUND"
    err = type("S", (), {"get": lambda self, *a, **k: _Res(GEO_ERR)})()
    with pytest.raises(RuntimeError) as e:
        _hook(err).geocode("a", "road")
    assert "INVALID_KEY" in str(e.value) and "SECRETKEY" not in str(e.value)

