#!/bin/bash
# DB 통합 테스트 (로컬): postgis 컨테이너에 테스트 전용 DB ev_test 재생성 → DDL 적용 → pytest tests/db
# 운영 DB(ev_platform)는 건드리지 않음. 사용: scripts/test_db.sh [pytest 인자]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

psql_in() { docker compose exec -T postgis sh -c "PGOPTIONS='-c client_min_messages=warning' psql -v ON_ERROR_STOP=1 -q -U \"\$POSTGRES_USER\" -d $1"; }

echo "DROP DATABASE IF EXISTS ev_test; CREATE DATABASE ev_test;" | psql_in postgres
psql_in ev_test < custom_image/postgis/initdb/00_extensions_schemas.sql
for f in files/sqls/ddl/*.sql; do psql_in ev_test < "$f"; done

EV_TEST_DB_URL="postgresql://${EV_DB_USER}:${EV_DB_PASSWORD}@localhost:${EV_DB_PORT:-5432}/ev_test" \
  pytest -q tests/db "$@"
