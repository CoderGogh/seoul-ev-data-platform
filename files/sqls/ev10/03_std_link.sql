-- 표준링크 형상: 전국 원본 중 매핑에 쓰인 링크만
-- 파라미터: shp_ver, mapping_ver
DELETE FROM core.std_link WHERE shp_ver = %(shp_ver)s;
INSERT INTO core.std_link (shp_ver, link_id, road_name, road_rank, lanes, max_spd, geom)
SELECT %(shp_ver)s, r.link_id, r.road_name, r.road_rank, r.lanes::int, r.max_spd::int, ST_GeometryN(r.geom, 1)
FROM staging.moct_link_raw r
WHERE r.link_id IN (SELECT std_link_id FROM core.service_link_map WHERE mapping_ver = %(mapping_ver)s);
