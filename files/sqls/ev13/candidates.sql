-- 보존 정리 후보: 보존 기간 경과분 중 삭제 가능 / 보호(사유별) 건수
-- 원칙: 기간 경과만으로 지우지 않음. 재처리·계보 근거가 남아 있으면 보호
-- 파라미터: retention_days
WITH cutoff AS (SELECT now() - make_interval(days => %(retention_days)s) AS ts),
open_req AS (  -- 진행 중 재처리 요청 기간
    SELECT date_from, date_to FROM ops.reprocess_request WHERE status IN ('requested', 'running')
),
obs AS (  -- 관측 이력: 시간대 확정·해당 기간 게시·열린 재처리 요청 여부
    SELECT o.link_id, o.poll_batch_id,
           coalesce(lt.is_final, false) AS is_final,
           EXISTS (SELECT 1 FROM ops.publish_log pl
                   WHERE o.collected_at BETWEEN pl.traffic_window_start AND pl.traffic_window_end) AS published,
           EXISTS (SELECT 1 FROM open_req r
                   WHERE (o.collected_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN r.date_from AND r.date_to) AS requested
    FROM core.traffic_obs o CROSS JOIN cutoff  -- 쉼표 조인은 뒤 LEFT JOIN 에서 o 참조 불가
    LEFT JOIN core.link_timeband lt
      ON lt.link_id = o.link_id
     AND lt.obs_date = (o.collected_at AT TIME ZONE 'Asia/Seoul')::date
     AND lt.timeband = extract(hour FROM o.collected_at AT TIME ZONE 'Asia/Seoul')
    WHERE o.collected_at < cutoff.ts
),
raw AS (  -- 도로 원천: 회차 처리 완료(커버리지 기록) 여부
    SELECT r.poll_batch_id, EXISTS (SELECT 1 FROM ops.poll_coverage c WHERE c.poll_batch_id = r.poll_batch_id) AS processed
    FROM staging.traffic_raw r, cutoff WHERE r.collected_at < cutoff.ts
),
reg_raw AS (  -- 등록 원천: 실행 상태 확정 여부
    SELECT r.run_id, EXISTS (SELECT 1 FROM ops.pipeline_run p WHERE p.run_id = r.run_id AND p.status <> 'running') AS settled
    FROM staging.registration_raw r, cutoff WHERE r.loaded_at < cutoff.ts
),
q AS (
    SELECT created_at FROM quarantine.traffic_record, cutoff WHERE created_at < cutoff.ts
    UNION ALL
    SELECT created_at FROM quarantine.registration_record, cutoff WHERE created_at < cutoff.ts
)
SELECT 'core.traffic_obs' AS target, count(*) AS expired,
       count(*) FILTER (WHERE is_final AND published AND NOT requested) AS deletable,
       count(*) FILTER (WHERE NOT is_final) AS protect_unfinal,
       count(*) FILTER (WHERE is_final AND NOT published) AS protect_unpublished,
       count(*) FILTER (WHERE is_final AND published AND requested) AS protect_open_request
FROM obs
UNION ALL
SELECT 'staging.traffic_raw', count(*), count(*) FILTER (WHERE processed), count(*) FILTER (WHERE NOT processed), 0, 0
FROM raw
UNION ALL
SELECT 'staging.registration_raw', count(*), count(*) FILTER (WHERE settled), count(*) FILTER (WHERE NOT settled), 0, 0
FROM reg_raw
UNION ALL
SELECT 'quarantine.*', count(*), count(*), 0, 0, 0 FROM q;
