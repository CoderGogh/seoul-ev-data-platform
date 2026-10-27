-- Gate 1 점검 지표 (기준월·도로 최신성·커버리지·마스터·시간대 수)
-- 파라미터: base_month, prev_month, window_start, window_end, target_set
WITH tl AS (
    SELECT t.* FROM core.target_link t
    JOIN core.master_version v ON v.master_type = 'link' AND v.version = t.link_ver AND v.status = 'active'
    WHERE t.target_set = %(target_set)s AND NOT t.is_excluded
), hours AS (  -- 분석 기간 내 주간 목표 시간 (분모, 사전 고정)
    SELECT h AS hour_start FROM generate_series(date_trunc('hour', %(window_start)s::timestamptz + interval '59 minutes'),
                                                %(window_end)s::timestamptz - interval '1 hour', interval '1 hour') h
    WHERE extract(hour FROM h AT TIME ZONE 'Asia/Seoul') BETWEEN 7 AND 21
), obs AS (
    SELECT lt.link_id, (lt.obs_date + make_interval(hours => lt.timeband)) AT TIME ZONE 'Asia/Seoul' AS hour_start
    FROM core.link_timeband lt JOIN tl ON tl.service_link_id = lt.link_id
    WHERE lt.is_final
)
SELECT
    (SELECT count(*) FROM core.reg_snapshot WHERE base_month = %(base_month)s AND fuel_cd = 'e') AS reg_rows,
    (SELECT count(*) FROM core.reg_snapshot WHERE base_month = %(prev_month)s AND fuel_cd = 'e') AS prev_rows,
    (SELECT max(quality_grade) FROM ops.reg_load WHERE base_month = %(base_month)s) AS reg_grade,
    (SELECT max(collected_at) FROM core.traffic_obs) AS last_collected_at,
    (SELECT count(*) FROM tl) AS target_links,
    (SELECT count(*) FROM hours) AS expected_hours,
    (SELECT count(*) FROM obs JOIN hours USING (hour_start)) AS observed_link_hours,
    (SELECT count(DISTINCT hour_start) FROM obs JOIN hours USING (hour_start)) AS observed_hours,
    (SELECT count(*) FROM core.master_version WHERE status = 'active') AS active_masters,
    (SELECT count(*) FROM tl) > 0 AS target_on_active_link;
