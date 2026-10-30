-- 서울 행정동 경계 GeoJSON (활성 경계, 15m 단순화, WGS84 소수 5자리)
SELECT json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(
           json_build_object(
               'type', 'Feature',
               'properties', json_build_object('adm_cd', d.adm_cd, 'adm_nm', d.adm_nm, 'sgg_nm', d.sgg_nm,
                                               'is_target', d.adm_cd IN (SELECT adm_cd FROM core.target_link)),
               'geometry', ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(a.geom, 15), 4326), 5)::json
           ) ORDER BY d.adm_cd), '[]'))
FROM mart.dim_admdong d
JOIN core.admdong a USING (boundary_ver, adm_cd);
