-- 서비스링크 형상: 표준링크 순서대로 연결, 틈은 직선 보간, 중점 계산
-- 파라미터: link_ver, mapping_ver, shp_ver
DELETE FROM core.service_link WHERE link_ver = %(link_ver)s;
INSERT INTO core.service_link (link_ver, service_link_id, std_cnt, std_hit, length_m, gap_len_m, geom, mid)
WITH seg AS (
    SELECT m.service_link_id, m.std_link_seq, m.row_no, l.geom,
           lag(ST_EndPoint(l.geom)) OVER (PARTITION BY m.service_link_id ORDER BY m.std_link_seq NULLS LAST, m.row_no) AS prev_end
    FROM core.service_link_map m
    JOIN core.std_link l ON l.link_id = m.std_link_id AND l.shp_ver = %(shp_ver)s
    WHERE m.mapping_ver = %(mapping_ver)s
), cnt AS (
    SELECT service_link_id, count(*) AS std_cnt
    FROM core.service_link_map WHERE mapping_ver = %(mapping_ver)s GROUP BY 1
), line AS (
    SELECT s.service_link_id, c.std_cnt, count(*) AS std_hit,
           ST_MakeLine(s.geom ORDER BY s.std_link_seq NULLS LAST, s.row_no) AS geom,  -- 순번 → 원천 행 순서
           coalesce(sum(ST_Distance(s.prev_end, ST_StartPoint(s.geom))), 0) AS gap_len_m
    FROM seg s JOIN cnt c USING (service_link_id)
    GROUP BY s.service_link_id, c.std_cnt
)
SELECT %(link_ver)s, service_link_id, std_cnt, std_hit,
       round(ST_Length(geom)::numeric, 1), round(gap_len_m::numeric, 1),
       geom, ST_LineInterpolatePoint(geom, 0.5)
FROM line;
