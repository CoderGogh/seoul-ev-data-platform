-- 회차별 커버리지 기록 (분모 = 사전 고정 대상 링크). 기록되면 처리 완료 회차로 간주
INSERT INTO ops.poll_coverage (poll_batch_id, run_id, target_set, target_cnt, ok_cnt, no_data_cnt, api_error_cnt,
                               invalid_cnt, excluded_cnt, planned_chunks, done_chunks, collected_at)
SELECT r.poll_batch_id, %(run_id)s, %(target_set)s,
       (SELECT count(*) FROM core.target_link WHERE target_set = %(target_set)s AND NOT is_excluded),
       count(*) FILTER (WHERE o.link_id IS NOT NULL),
       count(*) FILTER (WHERE r.call_status = 'no_data'),
       count(*) FILTER (WHERE r.call_status = 'api_error'),
       count(*) FILTER (WHERE q.link_id IS NOT NULL),
       (SELECT count(*) FROM core.target_link WHERE target_set = %(target_set)s AND is_excluded),
       coalesce((SELECT nullif(count(*), 0) FROM ops.poll_chunk c WHERE c.poll_batch_id = r.poll_batch_id),
                count(DISTINCT r.chunk_no)),  -- 계획 기록 없는 회차(임시 수집기)는 실제 묶음 수
       coalesce((SELECT nullif(count(*) FILTER (WHERE c.status = 'done'), 0) FROM ops.poll_chunk c
                 WHERE c.poll_batch_id = r.poll_batch_id), count(DISTINCT r.chunk_no)),
       min(r.collected_at)
FROM staging.traffic_raw r
LEFT JOIN core.traffic_obs o ON o.poll_batch_id = r.poll_batch_id AND o.link_id = r.link_id
LEFT JOIN quarantine.traffic_record q ON q.poll_batch_id = r.poll_batch_id AND q.link_id = r.link_id
WHERE r.poll_batch_id = ANY (%(batch_ids)s)
GROUP BY r.poll_batch_id
ON CONFLICT (poll_batch_id) DO NOTHING
RETURNING poll_batch_id, target_cnt, ok_cnt, no_data_cnt, api_error_cnt, invalid_cnt, planned_chunks, done_chunks;
