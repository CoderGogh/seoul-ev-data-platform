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


# 여러 SQL 파일을 단일 트랜잭션으로 실행 (하나라도 실패하면 전체 롤백)
# steps: [(rel_path, params, fetch)], fetch 결과는 다음 단계 params 에 병합
def run_in_transaction(steps):
    results = {}
    with closing(get_conn()) as conn:
        with conn, conn.cursor() as cur:
            for rel_path, params, fetch in steps:
                cur.execute(read_sql(rel_path), {**(params or {}), **results})
                if fetch:
                    cols = [d[0] for d in cur.description]
                    results.update(dict(zip(cols, cur.fetchone())))
    return results
