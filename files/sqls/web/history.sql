-- 게시 이력(A 목록·분류 분포) + 재처리 요청 이력. 요청자는 공개 데이터라 제외
SELECT json_build_object(
    'publishes', (SELECT coalesce(json_agg(json_build_object(
                      'base_month', base_month, 'run_id', run_id, 'published_at', published_at,
                      'threshold_ver', threshold_ver, 'region_cnt', region_cnt, 'request_id', request_id,
                      'a_list', a_list, 'class_dist', class_dist) ORDER BY published_at), '[]')
                  FROM ops.publish_log),
    'reprocess', (SELECT coalesce(json_agg(json_build_object(
                      'request_id', request_id, 'scope', scope, 'base_months', base_months,
                      'date_from', date_from, 'date_to', date_to, 'force', force, 'reason', reason,
                      'status', status, 'requested_at', requested_at, 'finished_at', finished_at)
                      ORDER BY requested_at), '[]')
                  FROM ops.reprocess_request)
);
