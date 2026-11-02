# 공공데이터포털(data.go.kr) OpenAPI Hook: 호출·JSON/XML 파싱·결과 코드 판정
# URL 형식: https://apis.data.go.kr/{기관}/{서비스}/{오퍼레이션}?serviceKey=...&pageNo=&numOfRows=&dataType=JSON
# 게이트웨이 오류(인증키 미등록·한도 초과)는 JSON 요청에도 XML 로 응답
import json
import math
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from urllib.parse import unquote

import requests
from airflow.sdk import BaseHook, Variable

OK_CODES = ("00", "0000")


@dataclass
class GoKrResult:
    code: str | None
    message: str | None = None
    total: int = 0
    rows: list = field(default_factory=list)
    resp_ms: int = 0

    @property
    def ok(self):
        return self.code in OK_CODES


def _as_list(items):
    # items 형태 통일: {"item": [...]} / {"item": {...}} / "" / [...]
    if isinstance(items, dict):
        items = items.get("item", [])
    if isinstance(items, dict):
        return [items]
    return items if isinstance(items, list) else []


class DataGoKrHook(BaseHook):
    conn_name_attr = "conn_id"
    default_conn_name = "conn_data_go_kr"
    hook_name = "data.go.kr OpenAPI"

    def __init__(self, api_key_var, conn_id=default_conn_name, timeout=60, **kwargs):
        """
        api_key_var: 인증키 Variable 이름 (일반 인증키, Encoding·Decoding 모두 허용)
        conn_id: 호스트 Connection
        """
        super().__init__(**kwargs)
        self.conn_id = conn_id
        self.api_key_var = api_key_var
        self.timeout = timeout
        self._base = None
        self._key = None
        self._session = None

    # 기본 주소·인증키 (인증키 로그 출력 금지)
    def get_conn(self):
        if self._base is None:
            c = self.get_connection(self.conn_id)
            self._base = f"https://{c.host}"
            self._key = unquote(Variable.get(self.api_key_var))  # Encoding 키 이중 인코딩 방지
            self._session = requests.Session()
        return self._base

    # 응답 → GoKrResult (평면형·response/header/body 형·XML 오류 공통)
    @staticmethod
    def parse(content):
        try:
            d = json.loads(content)
        except ValueError:
            return DataGoKrHook._parse_xml(content)
        d = d.get("response", d)
        header, body = d.get("header", d), d.get("body", d)
        total = body.get("totalCount")
        return GoKrResult(
            code=str(header.get("resultCode")),
            message=header.get("resultMsg"),
            total=int(total) if total not in (None, "") else 0,
            rows=_as_list(body.get("items")),
        )

    @staticmethod
    def _parse_xml(content):
        root = ET.fromstring(content)
        total = root.findtext(".//totalCount")
        return GoKrResult(
            code=root.findtext(".//resultCode") or root.findtext(".//returnReasonCode"),
            message=root.findtext(".//resultMsg") or root.findtext(".//returnAuthMsg"),
            total=int(total) if total else 0,
            rows=[{c.tag: c.text for c in item} for item in root.iter("item")],
        )

    # 호출 1회, 오류 코드면 예외 (재시도 대상)
    def call(self, path, **params):
        base = self.get_conn()
        query = {"serviceKey": self._key, "dataType": "JSON", **params}
        t0 = time.perf_counter()
        res = self._session.get(f"{base}/{path}", params=query, timeout=self.timeout)
        res.raise_for_status()
        result = self.parse(res.content)
        result.resp_ms = int((time.perf_counter() - t0) * 1000)
        if not result.ok:
            raise RuntimeError(f"{path} 오류 {result.code}: {result.message}")
        return result

    # 전수 페이지 순회
    def fetch_all(self, path, page_size=9999, **params):
        first = self.call(path, pageNo=1, numOfRows=page_size, **params)
        rows = list(first.rows)
        for page in range(2, math.ceil(first.total / page_size) + 1):
            rows += self.call(path, pageNo=page, numOfRows=page_size, **params).rows
        return first.total, rows
