-- 링크 중점 → 행정동 귀속 (ST_Covers 후보 중 행정동코드 최솟값 1곳)
-- 파라미터: link_ver, boundary_ver, mapping_ver
DELETE FROM core.link_admdong WHERE link_ver = %(link_ver)s AND boundary_ver = %(boundary_ver)s;
INSERT INTO core.link_admdong (link_ver, boundary_ver, service_link_id, adm_cd, cand_cnt, assign_status)
SELECT %(link_ver)s, %(boundary_ver)s, m.service_link_id, c.adm_cd, coalesce(c.cand_cnt, 0),
       CASE WHEN s.service_link_id IS NULL THEN 'no_geometry'
            WHEN c.cand_cnt IS NULL THEN 'outside'
            WHEN c.cand_cnt > 1 THEN 'multi_resolved'
            ELSE 'assigned' END
FROM (SELECT DISTINCT service_link_id FROM core.service_link_map WHERE mapping_ver = %(mapping_ver)s) m
LEFT JOIN core.service_link s ON s.link_ver = %(link_ver)s AND s.service_link_id = m.service_link_id
LEFT JOIN LATERAL (
    SELECT min(a.adm_cd) AS adm_cd, count(*) AS cand_cnt
    FROM core.admdong a
    WHERE a.boundary_ver = %(boundary_ver)s AND ST_Covers(a.geom, s.mid)
    HAVING count(*) > 0
) c ON true;
