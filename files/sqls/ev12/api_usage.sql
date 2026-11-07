-- ev01 호출량·한도 오류·오류율 분포 (최근 hours 시간)
-- 호출량 = 회차 × 링크 기록 수 (묶음 재시도는 덮어써서 제외)
-- 파라미터: hours, limit_code
WITH calls AS (
    SELECT count(*) AS calls,
           count(*) FILTER (WHERE result_code = %(limit_code)s) AS limit_errors
    FROM staging.traffic_raw
    WHERE collected_at >= now() - make_interval(hours => %(hours)s)
),
rates AS (
    SELECT count(*) AS batches,
           count(*) FILTER (WHERE grade = 'ok') AS ok_cnt,
           count(*) FILTER (WHERE grade = 'warn') AS warn_cnt,
           count(*) FILTER (WHERE grade = 'fatal') AS fatal_cnt,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY metric) AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY metric) AS p95,
           max(metric) AS max
    FROM ops.quality_result
    WHERE dag_id = 'ev01_traffic_collect' AND check_name = 'api_error_rate'
      AND checked_at >= now() - make_interval(hours => %(hours)s)
)
SELECT calls.*, rates.* FROM calls, rates;
