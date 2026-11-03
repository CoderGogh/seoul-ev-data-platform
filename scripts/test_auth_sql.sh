#!/usr/bin/env bash
# 웹 로그인 권한 SQL 검증 (일회용 postgres 컨테이너, 프로젝트 DB 무관)
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="ev-auth-sql-test-$$"
IMAGE="${AUTH_TEST_IMAGE:-postgres:16}"

docker run -d --rm --name "$NAME" -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" >/dev/null
trap 'docker stop "$NAME" >/dev/null' EXIT

# 기동 대기
for _ in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres -q && break
  sleep 1
done

run() { docker exec -i "$NAME" psql -q -U postgres -v ON_ERROR_STOP=1 < "$1"; }
run supabase/tests/auth_stub.sql
for f in supabase/migrations/*.sql; do run "$f"; done
run supabase/tests/auth_roles_test.sql
