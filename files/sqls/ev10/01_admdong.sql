-- 행정동 경계 적재 (GeoJSON, 서울만, WGS84 → 5186)
-- 파라미터: boundary_ver, boundary_file (서버 경로, pg_read_file)
INSERT INTO core.master_version (master_type, version, source_ref)
VALUES ('boundary', %(boundary_ver)s, %(boundary_file)s)
ON CONFLICT (master_type, version) DO NOTHING;  -- 재실행 시 기존 상태 유지 (활성 버전 재빌드 중 공백 방지)

DELETE FROM core.admdong WHERE boundary_ver = %(boundary_ver)s;
INSERT INTO core.admdong (boundary_ver, adm_cd, adm_nm, sgg_cd, sgg_nm, geom)
SELECT %(boundary_ver)s,
       f->'properties'->>'adm_cd2',
       f->'properties'->>'adm_nm',
       f->'properties'->>'sgg',
       f->'properties'->>'sggnm',
       ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'), 4326), 5186))
FROM jsonb_array_elements(pg_read_file(%(boundary_file)s)::jsonb->'features') f
WHERE f->'properties'->>'sido' = '11';
