# 브이월드 지오코더 API 2.0 Hook: 주소 → 좌표 (WGS84)
# URL 형식: https://api.vworld.kr/req/address?service=address&request=getcoord&type=road|parcel&address=...&key=...
# 약관: 결과는 실시간 사용만, 저장 금지 → 호출자는 좌표를 DB에 남기지 않음
import json
import time
from dataclasses import dataclass

import requests
from airflow.sdk import BaseHook, Variable
from airflow.sdk.log import mask_secret

LIMIT_CODES = ("OVER_REQUEST_LIMIT",)  # 일 한도 초과 (당일 재호출 불가)
KEY_CODES = ("INVALID_KEY", "INCORRECT_KEY", "UNAVAILABLE_KEY")


@dataclass
class GeoResult:
    status: str  # OK / NOT_FOUND / ERROR
    lng: float | None = None
    lat: float | None = None
    error_code: str | None = None

    @property
    def found(self):
        return self.status == "OK" and self.lng is not None


class VWorldGeocoderHook(BaseHook):
    conn_name_attr = "conn_id"
    default_conn_name = "conn_vworld"
    hook_name = "VWorld Geocoder"

