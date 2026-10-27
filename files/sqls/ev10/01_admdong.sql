-- 행정동 경계 적재 (GeoJSON, 서울만, WGS84 → 5186)
-- 변수: boundary_ver, boundary_file
INSERT INTO core.master_version (master_type, version, source_ref)
VALUES ('boundary', :'boundary_ver', :'boundary_file')
ON CONFLICT (master_type, version) DO UPDATE SET status = 'pending', activated_at = NULL;

DELETE FROM core.admdong WHERE boundary_ver = :'boundary_ver';
INSERT INTO core.admdong (boundary_ver, adm_cd, adm_nm, sgg_cd, sgg_nm, geom)
SELECT :'boundary_ver',
       f->'properties'->>'adm_cd2',
       f->'properties'->>'adm_nm',
       f->'properties'->>'sgg',
       f->'properties'->>'sggnm',
       ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'), 4326), 5186))
FROM jsonb_array_elements(pg_read_file(:'boundary_file')::jsonb->'features') f
WHERE f->'properties'->>'sido' = '11';
