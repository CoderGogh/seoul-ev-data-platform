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

    def __init__(self, api_key_var="apikey_vworld", conn_id=default_conn_name, timeout=20, min_interval=0.05, **kwargs):
        """
        api_key_var: 인증키 Variable 이름
        conn_id: 호스트 Connection (extra.domain: 키 발급 시 등록한 서비스 URL)
        min_interval: 호출 간 최소 간격 초
        """
        super().__init__(**kwargs)
        self.conn_id = conn_id
        self.api_key_var = api_key_var
        self.timeout = timeout
        self.min_interval = min_interval
        self._base = None
        self._key = None
        self._domain = None
        self._session = None
        self._last = 0.0

    # 기본 주소·인증키 (인증키 로그 출력 금지)
    def get_conn(self):
        if self._base is None:
            c = self.get_connection(self.conn_id)
            self._base = f"https://{c.host}/req/address"
            self._domain = (c.extra_dejson or {}).get("domain") or None
            self._key = Variable.get(self.api_key_var, default="") or ""
            if self._key:
                mask_secret(self._key)
            self._session = requests.Session()
        return self._base

    def has_key(self):
        self.get_conn()
        return bool(self._key)

    # 응답 → GeoResult (오류는 코드만, 메시지 미사용)
    @staticmethod
    def parse(content):
        r = json.loads(content).get("response", {})
        status = r.get("status") or "ERROR"
        if status == "OK":
            p = (r.get("result") or {}).get("point") or {}
            try:
                return GeoResult("OK", float(p["x"]), float(p["y"]))
            except (KeyError, TypeError, ValueError):
                return GeoResult("ERROR", error_code="BAD_POINT")
        if status == "NOT_FOUND":
            return GeoResult("NOT_FOUND")
        return GeoResult("ERROR", error_code=(r.get("error") or {}).get("code") or "UNKNOWN")

