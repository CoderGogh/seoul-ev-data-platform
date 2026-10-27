#!/bin/bash
# Rshiny 읽기 전용 계정 (mart·ops 조회만 허용)
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
    CREATE ROLE rshiny_reader LOGIN PASSWORD '${RSHINY_DB_PASSWORD}';
    GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO rshiny_reader;
    GRANT USAGE ON SCHEMA mart, ops TO rshiny_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA mart, ops TO rshiny_reader;
    -- 이후 생성 테이블 자동 권한
    ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA mart, ops
        GRANT SELECT ON TABLES TO rshiny_reader;
SQL
