-- 품질 게이트 지표: 원천·격리·정제·귀속 (단지 수·세대 가중), 직전 적재 대비
-- 파라미터: run_id, snapshot_date
WITH a AS (
    SELECT count(*) AS norm, coalesce(sum(hh_cnt), 0) AS hh,
           count(*) FILTER (WHERE assign_status = 'assigned') AS assigned,
           coalesce(sum(hh_cnt) FILTER (WHERE assign_status = 'assigned'), 0) AS hh_assigned,
           count(*) FILTER (WHERE assign_status = 'sgg_mismatch') AS mismatch
    FROM staging.apt_norm WHERE run_id = %(run_id)s
), p AS (
    SELECT count(*) AS norm, coalesce(sum(space_cnt), 0) AS spaces,
           count(*) FILTER (WHERE assign_status = 'assigned') AS assigned,
           count(*) FILTER (WHERE loc_source = 'source_coord') AS source_coord
    FROM staging.parking_norm WHERE run_id = %(run_id)s
), prev AS (
    SELECT apt_cnt, parking_cnt FROM ops.aux_load
    WHERE snapshot_date < %(snapshot_date)s::date ORDER BY snapshot_date DESC, load_id DESC LIMIT 1
)
SELECT (SELECT count(*) FROM staging.apt_raw WHERE run_id = %(run_id)s) AS apt_raw,
