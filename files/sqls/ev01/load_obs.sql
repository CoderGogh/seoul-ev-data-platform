-- 유효 관측 멱등 적재 (링크 × 회차), 원천 관측시각 미제공
INSERT INTO core.traffic_obs (link_id, poll_batch_id, collected_at, source_observed_at, prcs_spd, prcs_trv_time, run_id)
SELECT r.link_id, r.poll_batch_id, r.collected_at, NULL, r.prcs_spd::numeric, r.prcs_trv_time::numeric, %(run_id)s
FROM staging.traffic_raw r
WHERE r.poll_batch_id = ANY (%(batch_ids)s)
  AND r.call_status = 'ok'
  AND r.prcs_spd ~ '^\d+(\.\d+)?$' AND r.prcs_trv_time ~ '^\d+(\.\d+)?$'
  AND r.prcs_spd::numeric <= %(max_spd)s AND r.prcs_trv_time::numeric > 0
ON CONFLICT (link_id, poll_batch_id) DO NOTHING;
