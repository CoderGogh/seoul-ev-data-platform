#!/bin/bash
# 마스터 원천 준비 후 ev10 트리거
# 1) 매핑 xlsx → JSON  2) 표준노드링크 SHP → staging.moct_link_raw  3) ev10_master_refresh 실행
# ev10 이 경계·매핑·형상·귀속·품질 게이트·활성화·수집 대상을 처리하고 원본을 정리한다
set -euo pipefail
cd "$(dirname "$0")/.."

MAPPING_VER="20250306"
SHP="/data/master/[2026-10-14]NODELINKDATA/MOCT_LINK.shp"

psql_run() {
  docker compose exec -T postgis bash -c "PGOPTIONS='-c client_min_messages=warning' psql -v ON_ERROR_STOP=1 -q -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\""
}

echo "[1/3] 매핑 xlsx → JSON"
python3 -I scripts/xlsx_to_json.py "files/master/link_mapping_${MAPPING_VER}.xlsx" "files/master/link_mapping_${MAPPING_VER}.json" --header

echo "[2/3] 표준노드링크 SHP → staging.moct_link_raw (전국, EPSG:5186, CP949)"
echo "DROP TABLE IF EXISTS staging.moct_link_raw;" | psql_run
docker compose exec -T postgis bash -c "shp2pgsql -c -s 5186 -W CP949 -D '${SHP}' staging.moct_link_raw" | psql_run
echo "CREATE INDEX ON staging.moct_link_raw (link_id);" | psql_run

echo "[3/3] ev10_master_refresh 트리거 (기본 params)"
docker compose exec -T airflow-scheduler airflow dags trigger ev10_master_refresh
