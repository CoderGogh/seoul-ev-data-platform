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


