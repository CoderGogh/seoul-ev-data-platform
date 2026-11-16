-- 점 → 활성 경계 행정동 (점은 이 문장 안에서만 사용, 행정동 코드만 기록)
-- 파라미터: run_id, points (JSON 배열: src, src_key, lng, lat, loc_source)
DELETE FROM staging.aux_locate WHERE run_id = %(run_id)s;

INSERT INTO staging.aux_locate (run_id, src, src_key, adm_cd, loc_source)
WITH b AS (SELECT version FROM core.master_version WHERE master_type = 'boundary' AND status = 'active')
SELECT %(run_id)s, p.src, p.src_key, a.adm_cd, p.loc_source
FROM jsonb_to_recordset(%(points)s::jsonb) AS p(src text, src_key text, lng float8, lat float8, loc_source text)
CROSS JOIN b
LEFT JOIN LATERAL (
    SELECT d.adm_cd FROM core.admdong d
    WHERE p.lng IS NOT NULL AND d.boundary_ver = b.version
      AND ST_Contains(d.geom, ST_Transform(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326), 5186))
    ORDER BY d.adm_cd LIMIT 1  -- 경계선 위 점은 코드 순 첫 동
) a ON true;
