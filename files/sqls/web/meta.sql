-- 게시 상태·임계값·분석 기간·파이프라인 실행 요약
WITH cur AS (
    SELECT * FROM ops.publish_status WHERE status = 'current' ORDER BY base_month DESC LIMIT 1
), pub AS (
    SELECT l.* FROM ops.publish_log l JOIN cur ON l.base_month = cur.base_month AND l.run_id = cur.last_published_run
)
SELECT json_build_object(
    'base_month', cur.base_month,
    'publish_status', cur.status,
    'published_at', cur.last_published_at,
    'traffic_window_start', pub.traffic_window_start,
    'traffic_window_end', pub.traffic_window_end,
    'period_mismatch', pub.period_mismatch,
    'link_ver', pub.link_ver,
    'boundary_ver', pub.boundary_ver,
    'region_cnt', pub.region_cnt,
    'threshold', (SELECT json_build_object('ver', threshold_ver, 'basis', basis, 'params', params)
                  FROM ops.threshold_version WHERE is_active),
    'reg_months', (SELECT json_agg(DISTINCT base_month ORDER BY base_month) FROM mart.v_reg_monthly),
    'pipeline', (SELECT json_agg(p ORDER BY p.dag_id, p.status) FROM (
                     SELECT dag_id, status, count(*) AS runs, max(finished_at) AS last_finished_at
                     FROM ops.pipeline_run GROUP BY dag_id, status) p),
    'poll', (SELECT json_build_object('batches', count(*), 'first_at', min(collected_at), 'last_at', max(collected_at),
                                      'ok_ratio', round(100.0 * sum(ok_cnt) / nullif(sum(target_cnt), 0), 1))
             FROM ops.poll_coverage),
    'exported_at', now()
)
FROM cur JOIN pub ON true;
