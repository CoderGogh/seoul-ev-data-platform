-- 수집 대상 링크별 저속 비중 (현재 게시 기준월 분석 기간, 주간 확정 관측) → 도로 여건 타일
-- links: [링크ID, 행정동, 저속 비중(%), 관측 링크-시간]
WITH cur AS (
    SELECT f.base_month, min(f.traffic_window_start) AS ws, max(f.traffic_window_end) AS we
    FROM mart.fact_admdong_indicator f
    WHERE f.base_month = (SELECT max(base_month) FROM ops.publish_status WHERE status = 'current')
    GROUP BY f.base_month
), p AS (
    SELECT (params->>'low_spd_kmh')::numeric AS low_kmh FROM ops.threshold_version WHERE is_active
), obs AS (
    SELECT lt.link_id, count(*) AS n, count(*) FILTER (WHERE lt.rep_spd < p.low_kmh) AS low
    FROM core.link_timeband lt CROSS JOIN cur CROSS JOIN p
    WHERE lt.is_final AND lt.timeband BETWEEN 7 AND 21
      AND (lt.obs_date + make_interval(hours => lt.timeband)) AT TIME ZONE 'Asia/Seoul' >= cur.ws
      AND (lt.obs_date + make_interval(hours => lt.timeband + 1)) AT TIME ZONE 'Asia/Seoul' <= cur.we
    GROUP BY lt.link_id
)
SELECT json_build_object(
    'base_month', cur.base_month,
    'window', json_build_object('start', cur.ws, 'end', cur.we),
    'links', coalesce((
        SELECT json_agg(json_build_array(t.service_link_id, t.adm_cd, round(100.0 * o.low / nullif(o.n, 0), 1),
                                         coalesce(o.n, 0)) ORDER BY t.adm_cd, t.service_link_id)
        FROM core.target_link t LEFT JOIN obs o ON o.link_id = t.service_link_id
        WHERE t.target_set = (SELECT max(target_set) FROM core.target_link) AND NOT t.is_excluded
    ), '[]')
)
FROM cur;
