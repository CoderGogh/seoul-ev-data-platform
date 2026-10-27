# 분석 DB 접근 (conn_postgis_ev), SQL 파일 실행
import os
from contextlib import closing
from pathlib import Path

from airflow.providers.postgres.hooks.postgres import PostgresHook

CONN_ID = "conn_postgis_ev"
SQL_DIR = Path(os.environ.get("EV_SQL_DIR", "/opt/airflow/files/sqls"))


def get_conn():
    return PostgresHook(postgres_conn_id=CONN_ID).get_conn()


def read_sql(rel_path):
    return (SQL_DIR / rel_path).read_text(encoding="utf-8")


# 단일 트랜잭션 실행 (실패 시 롤백), 마지막 결과 행 반환
def execute(sql, params=None, fetch=False):
    with closing(get_conn()) as conn:
        with conn, conn.cursor() as cur:
            cur.execute(sql, params)
            if fetch:
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, r)) for r in cur.fetchall()]
    return None


def execute_file(rel_path, params=None, fetch=False):
    return execute(read_sql(rel_path), params, fetch)
