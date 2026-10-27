#!/bin/bash
# 마스터 원천 일회성 적재 (MVP의 ev10 대체)
# 사용: scripts/load_master.sh [스키마=scratch]
# 전제: files/master 에 NODELINKDATA, 경계 GeoJSON, 매핑 JSON 존재
set -euo pipefail
cd "$(dirname "$0")/.."

SCHEMA="${1:-scratch}"
NODELINK_DIR="/data/master/[2026-10-14]NODELINKDATA"
BOUNDARY="/data/master/boundary/HangJeongDong_ver20260701.geojson"
MAPPING="/data/master/link_mapping_20250306.json"

psql_exec() {
  docker compose exec -T postgis bash -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q'
}

echo "[1/4] 스키마 준비: ${SCHEMA}"
echo "CREATE SCHEMA IF NOT EXISTS ${SCHEMA};" | psql_exec

echo "[2/4] 표준링크 SHP 적재 (EPSG:5186, CP949)"
echo "DROP TABLE IF EXISTS ${SCHEMA}.moct_link;" | psql_exec
docker compose exec -T postgis bash -c "shp2pgsql -c -s 5186 -W CP949 -I -D '${NODELINK_DIR}/MOCT_LINK.shp' ${SCHEMA}.moct_link" | psql_exec

echo "[3/4] 행정동 경계 적재 (서울, WGS84 → 5186)"
psql_exec <<SQL
DROP TABLE IF EXISTS ${SCHEMA}.admdong_boundary;
CREATE TABLE ${SCHEMA}.admdong_boundary AS
SELECT f->'properties'->>'adm_cd2' AS adm_cd,
       f->'properties'->>'adm_nm'  AS adm_nm,
       f->'properties'->>'sgg'     AS sgg_cd,
       f->'properties'->>'sggnm'   AS sgg_nm,
       'ver20260701'::text          AS boundary_ver,
       ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'), 4326), 5186)::geometry(MultiPolygon, 5186) AS geom
FROM jsonb_array_elements(pg_read_file('${BOUNDARY}')::jsonb->'features') f
WHERE f->'properties'->>'sido' = '11';
CREATE INDEX ON ${SCHEMA}.admdong_boundary USING gist (geom);
SQL

echo "[4/4] 서비스링크-표준링크 매핑 적재"
psql_exec <<SQL
DROP TABLE IF EXISTS ${SCHEMA}.link_mapping;
CREATE TABLE ${SCHEMA}.link_mapping AS
SELECT r->>0 AS service_link_id,
       (r->>1)::int AS std_link_seq,
       NULLIF(r->>2, '') AS std_link_id,
       '20250306'::text AS mapping_ver
FROM jsonb_array_elements(pg_read_file('${MAPPING}')::jsonb->'rows') r;
CREATE INDEX ON ${SCHEMA}.link_mapping (std_link_id);
SQL

echo "완료"
