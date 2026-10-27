#!/bin/bash
# 마스터 일회성 적재·활성화 (MVP의 ev10 대체)
# 순서: 경계 → 매핑 → 표준링크 형상 → 서비스링크 형상 → 귀속 → 품질·활성화 → 수집 대상 고정
# 전제: scripts/apply_ddl.sh 적용, files/master 에 원천 파일 존재
set -euo pipefail
cd "$(dirname "$0")/.."

# 버전·대상 설정
BOUNDARY_VER="ver20260701"
MAPPING_VER="20250306"
SHP_VER="20261014"
LINK_VER="map${MAPPING_VER}_shp${SHP_VER}"
TARGET_SET="mvp_3gu_v1"
TARGET_SGG="강남구,서초구,송파구"
MIN_ASSIGN_RATE=95

# 컨테이너 내부 경로 (files/master → /data/master)
SHP="/data/master/[2026-10-14]NODELINKDATA/MOCT_LINK.shp"
BOUNDARY_FILE="/data/master/boundary/HangJeongDong_${BOUNDARY_VER}.geojson"
MAPPING_FILE="/data/master/link_mapping_${MAPPING_VER}.json"

psql_run() {
  docker compose exec -T postgis bash -c "PGOPTIONS='-c client_min_messages=warning' psql -v ON_ERROR_STOP=1 -q -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" \
    -v boundary_ver=${BOUNDARY_VER} -v mapping_ver=${MAPPING_VER} -v shp_ver=${SHP_VER} -v link_ver=${LINK_VER} \
    -v target_set=${TARGET_SET} -v target_sgg=${TARGET_SGG} -v min_assign_rate=${MIN_ASSIGN_RATE} \
    -v 'boundary_file=${BOUNDARY_FILE}' -v 'mapping_file=${MAPPING_FILE}'"
}

echo "[1/4] 매핑 xlsx → JSON"
python3 -I scripts/xlsx_to_json.py "files/master/link_mapping_${MAPPING_VER}.xlsx" "files/master/link_mapping_${MAPPING_VER}.json" --header

echo "[2/4] 표준노드링크 SHP → staging.moct_link_raw (전국, EPSG:5186, CP949)"
echo "DROP TABLE IF EXISTS staging.moct_link_raw;" | psql_run
docker compose exec -T postgis bash -c "shp2pgsql -c -s 5186 -W CP949 -D '${SHP}' staging.moct_link_raw" | psql_run
echo "CREATE INDEX ON staging.moct_link_raw (link_id);" | psql_run

echo "[3/4] 마스터 빌드 (files/sqls/ev10)"
for f in files/sqls/ev10/*.sql; do
  echo "  $f"
  psql_run < "$f"
done

echo "[4/4] 전국 원본 정리"
echo "DROP TABLE staging.moct_link_raw;" | psql_run

echo "결과"
psql_run <<SQL
\pset footer off
SELECT master_type, version, status, quality FROM core.master_version ORDER BY 1, 2;
SELECT assign_status, count(*) FROM core.link_admdong WHERE link_ver = :'link_ver' GROUP BY 1 ORDER BY 2 DESC;
SELECT a.sgg_nm, count(*) AS links, count(DISTINCT t.adm_cd) AS admdongs
FROM core.target_link t JOIN core.admdong a ON a.boundary_ver = t.boundary_ver AND a.adm_cd = t.adm_cd
WHERE t.target_set = :'target_set' GROUP BY ROLLUP (1) ORDER BY 1;
SQL
