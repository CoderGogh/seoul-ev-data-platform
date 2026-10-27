-- 값 검증 실패 격리: 정상 응답이지만 속도·여행시간이 숫자가 아니거나 범위 밖
INSERT INTO quarantine.traffic_record (poll_batch_id, link_id, run_id, reason_code, raw)
SELECT r.poll_batch_id, r.link_id, %(run_id)s,
       CASE WHEN r.prcs_spd !~ '^\d+(\.\d+)?$' OR r.prcs_trv_time !~ '^\d+(\.\d+)?$' THEN 'non_numeric'
            WHEN r.prcs_spd::numeric > %(max_spd)s THEN 'spd_out_of_range'
            ELSE 'trv_time_non_positive' END,
       to_jsonb(r)
FROM staging.traffic_raw r
WHERE r.poll_batch_id = ANY (%(batch_ids)s)
  AND r.call_status = 'ok'
  AND NOT (r.prcs_spd ~ '^\d+(\.\d+)?$' AND r.prcs_trv_time ~ '^\d+(\.\d+)?$'
           AND r.prcs_spd::numeric <= %(max_spd)s AND r.prcs_trv_time::numeric > 0)
ON CONFLICT (poll_batch_id, link_id) DO NOTHING;
