-- 유효 관측 멱등 적재 (링크 × 회차), 원천 관측시각 미제공
-- 월 파티션 보장 (이번 달·다음 달)
SELECT core.ensure_traffic_obs_partitions(now(), 2);

-- 멱등 키는 링크 × 회차 (PK 는 파티션 키 포함이라 존재 여부로 판단)
INSERT INTO core.traffic_obs (link_id, poll_batch_id, collected_at, source_observed_at, prcs_spd, prcs_trv_time, run_id)
SELECT r.link_id, r.poll_batch_id, r.collected_at, NULL, r.prcs_spd::numeric, r.prcs_trv_time::numeric, %(run_id)s
FROM staging.traffic_raw r
WHERE r.poll_batch_id = ANY (%(batch_ids)s)
  AND r.call_status = 'ok'
  AND r.prcs_spd ~ '^\d+(\.\d+)?$' AND r.prcs_trv_time ~ '^\d+(\.\d+)?$'
  AND r.prcs_spd::numeric <= %(max_spd)s AND r.prcs_trv_time::numeric > 0
  AND NOT EXISTS (SELECT 1 FROM core.traffic_obs o WHERE o.link_id = r.link_id AND o.poll_batch_id = r.poll_batch_id)
ON CONFLICT DO NOTHING;
