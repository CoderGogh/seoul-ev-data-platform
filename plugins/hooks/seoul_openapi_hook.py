# 서울 열린데이터광장 OpenAPI Hook: 주소 조립·호출·XML 파싱·결과 코드 판정을 한 곳에서
# URL 형식: http://{host}:{port}/{인증키}/xml/{서비스}/{시작}/{끝}/{추가 인자...}
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import requests
from airflow.sdk import BaseHook, Variable

OK = "INFO-000"
NO_DATA = "INFO-200"


@dataclass
class ApiResult:
    code: str
    message: str | None = None
    total: int = 0
    rows: list = field(default_factory=list)
    resp_ms: int = 0

    # 호출 상태: ok / no_data / api_error (링크 단위 기록용)
    @property
    def status(self):
        if self.code == OK and self.rows:
            return "ok"
        return "no_data" if self.code == NO_DATA else "api_error"


class SeoulOpenApiHook(BaseHook):
    conn_name_attr = "conn_id"
    default_conn_name = "conn_seoul_openapi"
    hook_name = "Seoul OpenAPI"

    def __init__(self, api_key_var, conn_id=default_conn_name, timeout=30, **kwargs):
        """
        api_key_var: 인증키 Variable 이름 (데이터셋별 키)
        conn_id: 호스트·포트 Connection
        """
        super().__init__(**kwargs)
        self.conn_id = conn_id
        self.api_key_var = api_key_var
        self.timeout = timeout
        self._base = None
        self._session = None

    # 기본 주소 (인증키 포함, 로그 출력 금지)
    def get_conn(self):
        if self._base is None:
            c = self.get_connection(self.conn_id)
            self._base = f"http://{c.host}:{c.port}/{Variable.get(self.api_key_var)}/xml"
            self._session = requests.Session()  # 링크 순회 시 연결 재사용
        return self._base

    # XML 응답 → ApiResult (필드명 대문자 통일: 실제 응답은 서비스마다 대소문자 다름)
    @staticmethod
    def parse(content):
        root = ET.fromstring(content)
        total = root.findtext("list_total_count")
        return ApiResult(
            code=root.findtext(".//CODE"),
            message=root.findtext(".//MESSAGE"),
            total=int(total) if total else 0,
            rows=[{c.tag.upper(): c.text for c in row} for row in root.findall("row")],
        )

    # 호출 1회. raise_on_error=False 면 오류도 ApiResult 로 반환 (링크 단위 부분 실패 허용)
    def call(self, service, start=1, end=5, *args, raise_on_error=True):
        base = self.get_conn()
        path = "/".join([service, str(start), str(end), *map(str, args)])
        t0 = time.perf_counter()
        try:
            res = self._session.get(f"{base}/{path}", timeout=self.timeout)
            res.raise_for_status()
            result = self.parse(res.content)
        except Exception as e:
            if raise_on_error:
                raise
            result = ApiResult(code=f"EXC:{type(e).__name__}", message=str(e)[:200])
        result.resp_ms = int((time.perf_counter() - t0) * 1000)
        if raise_on_error and result.code not in (OK, NO_DATA):
            raise RuntimeError(f"{service} 오류 {result.code}: {result.message}")
        return result

    # 전수 페이지 순회 (1회 최대 1,000건)
    def fetch_all(self, service, page_size=1000):
        first = self.call(service, 1, 1)
        rows = []
        for start in range(1, first.total + 1, page_size):
            rows += self.call(service, start, min(start + page_size - 1, first.total)).rows
        return first.total, rows
