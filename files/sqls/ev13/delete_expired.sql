-- 삭제 실행 (candidates 와 같은 조건, 단일 트랜잭션). dry_run=false 일 때만
-- 파라미터: retention_days
DELETE FROM staging.traffic_raw r
WHERE r.collected_at < now() - make_interval(days => %(retention_days)s)
  AND EXISTS (SELECT 1 FROM ops.poll_coverage c WHERE c.poll_batch_id = r.poll_batch_id);

DELETE FROM staging.registration_raw r
WHERE r.loaded_at < now() - make_interval(days => %(retention_days)s)
  AND EXISTS (SELECT 1 FROM ops.pipeline_run p WHERE p.run_id = r.run_id AND p.status <> 'running');

DELETE FROM quarantine.traffic_record WHERE created_at < now() - make_interval(days => %(retention_days)s);

DELETE FROM quarantine.registration_record WHERE created_at < now() - make_interval(days => %(retention_days)s);

DELETE FROM core.traffic_obs o
WHERE o.collected_at < now() - make_interval(days => %(retention_days)s)
  AND EXISTS (SELECT 1 FROM core.link_timeband lt
              WHERE lt.link_id = o.link_id AND lt.is_final
                AND lt.obs_date = (o.collected_at AT TIME ZONE 'Asia/Seoul')::date
                AND lt.timeband = extract(hour FROM o.collected_at AT TIME ZONE 'Asia/Seoul'))
  AND EXISTS (SELECT 1 FROM ops.publish_log pl
              WHERE o.collected_at BETWEEN pl.traffic_window_start AND pl.traffic_window_end)
  AND NOT EXISTS (SELECT 1 FROM ops.reprocess_request r
                  WHERE r.status IN ('requested', 'running')
                    AND (o.collected_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN r.date_from AND r.date_to);
