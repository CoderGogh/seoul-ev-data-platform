-- 미처리 회차: staging 에 있으나 커버리지 기록이 없는 회차 (임시 수집기·실패 회차 자동 흡수)
SELECT r.poll_batch_id, min(r.collected_at) AS collected_at, count(*) AS rows
FROM staging.traffic_raw r
WHERE NOT EXISTS (SELECT 1 FROM ops.poll_coverage c WHERE c.poll_batch_id = r.poll_batch_id)
GROUP BY r.poll_batch_id
ORDER BY min(r.collected_at);
