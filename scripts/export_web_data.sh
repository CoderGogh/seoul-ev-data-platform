#!/bin/bash
# 웹 화면용 정적 데이터 내보내기 (files/sqls/web/*.sql → web/public/data/*.json)
# PostGIS 만 실행된 상태에서 사용: docker compose up -d postgis
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=web/public/data
mkdir -p "$OUT"

for f in files/sqls/web/*.sql; do
  name=$(basename "$f" .sql)
  docker compose exec -T postgis bash -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAt' < "$f" > "$OUT/$name.json"
  # JSON 형식 검증
  python3 -I -m json.tool "$OUT/$name.json" > /dev/null
  echo "내보냄: $OUT/$name.json ($(wc -c < "$OUT/$name.json" | tr -d ' ') bytes)"
done
