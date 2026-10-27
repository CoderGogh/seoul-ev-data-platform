-- 매핑 품질 기록 후 활성화 (기준 미달 시 rejected)
-- 파라미터: link_ver, boundary_ver, shp_ver, mapping_ver, min_assign_rate
WITH q AS (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE assign_status IN ('assigned', 'multi_resolved')) AS assigned,
           count(*) FILTER (WHERE assign_status = 'no_geometry') AS no_geometry,
           count(*) FILTER (WHERE assign_status = 'outside') AS outside
    FROM core.link_admdong WHERE link_ver = %(link_ver)s AND boundary_ver = %(boundary_ver)s
), j AS (
    SELECT count(*) AS mapped, count(l.link_id) AS joined
    FROM (SELECT DISTINCT std_link_id FROM core.service_link_map WHERE mapping_ver = %(mapping_ver)s AND std_link_id IS NOT NULL) m
    LEFT JOIN core.std_link l ON l.link_id = m.std_link_id AND l.shp_ver = %(shp_ver)s
), a AS (
    -- 매핑 원천 이상: 순번 결측 행, 순번 중복 키
    SELECT count(*) FILTER (WHERE std_link_seq IS NULL) AS null_seq_rows,
           (SELECT count(*) FROM (SELECT 1 FROM core.service_link_map WHERE mapping_ver = %(mapping_ver)s AND std_link_seq IS NOT NULL
                                  GROUP BY service_link_id, std_link_seq HAVING count(*) > 1) d) AS dup_seq_keys
    FROM core.service_link_map WHERE mapping_ver = %(mapping_ver)s
), g AS (
    SELECT round(100 * sum(gap_len_m) / sum(length_m), 2) AS gap_pct FROM core.service_link WHERE link_ver = %(link_ver)s
)
INSERT INTO core.master_version (master_type, version, source_ref, quality)
SELECT 'link', %(link_ver)s, 'mapping ' || %(mapping_ver)s || ' + shp ' || %(shp_ver)s,
       jsonb_build_object(
           'std_join_rate', round(100.0 * j.joined / j.mapped, 2),
           'assign_rate', round(100.0 * q.assigned / q.total, 2),
           'no_geometry', q.no_geometry, 'outside', q.outside, 'gap_pct', g.gap_pct,
           'null_seq_rows', a.null_seq_rows, 'dup_seq_keys', a.dup_seq_keys,
           'boundary_ver', %(boundary_ver)s)
FROM q, j, a, g
ON CONFLICT (master_type, version) DO UPDATE SET quality = EXCLUDED.quality
RETURNING (quality->>'assign_rate')::numeric AS assign_rate, quality;
