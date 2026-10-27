# 서울 OpenAPI 기준월 공표 센서: 원천 최신 기준월이 대상 기준월과 같아질 때까지 대기
# 강의 SeoulApiDateSensor 를 월 단위 공표 데이터용으로 확장 (기준월 컬럼 비교, 파일 경로 통과)
from airflow.sdk import BaseSensorOperator
from hooks.seoul_openapi_hook import SeoulOpenApiHook


class SeoulApiBaseMonthSensor(BaseSensorOperator):
    template_fields = ("base_month", "source")

    def __init__(self, service, api_key_var, base_month, month_col="STATS_YM", source="api", **kwargs):
        """
        service: OpenAPI 서비스명 (예: TbDongFuelCar)
        api_key_var: 인증키 Variable 이름
        base_month: 대상 기준월 YYYYMM (템플릿 가능)
        month_col: 응답의 기준월 컬럼
        source: api 가 아니면 원천 공표 대기 불필요 → 즉시 통과 (파일 경로)
        """
        kwargs.setdefault("mode", "reschedule")  # 대기 중 워커 슬롯 반납
        super().__init__(**kwargs)
        self.service = service
        self.api_key_var = api_key_var
        self.base_month = base_month
        self.month_col = month_col
        self.source = source

    def poke(self, context):
        if self.source != "api":
            self.log.info("source=%s: 공표 대기 생략", self.source)
            return True
        result = SeoulOpenApiHook(api_key_var=self.api_key_var).call(self.service, 1, 1)
        latest = result.rows[0].get(self.month_col) if result.rows else None
        self.log.info("대상 %s / 원천 최신 %s", self.base_month, latest)
        return latest == self.base_month
