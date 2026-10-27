#!/bin/bash
# 분석 DB DDL 적용 (files/sqls/ddl 순서대로, 재실행 안전)
set -euo pipefail
cd "$(dirname "$0")/.."

for f in files/sqls/ddl/*.sql; do
  echo "적용: $f"
  docker compose exec -T postgis bash -c 'PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q' < "$f"
done
echo "완료"
