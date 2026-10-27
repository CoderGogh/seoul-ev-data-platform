# 분석 DB 접근 (conn_postgis_ev), SQL 파일 실행
import os
import re
from contextlib import closing
from pathlib import Path

from airflow.providers.postgres.hooks.postgres import PostgresHook

CONN_ID = "conn_postgis_ev"
SQL_DIR = Path(os.environ.get("EV_SQL_DIR", "/opt/airflow/files/sqls"))


def get_conn():
    return PostgresHook(postgres_conn_id=CONN_ID).get_conn()


def read_sql(rel_path):
    return (SQL_DIR / rel_path).read_text(encoding="utf-8")


# 문장 단위 분리 (psycopg 3 는 파라미터 사용 시 1회 1문장). 문장 끝 ';' (+ 같은 줄 주석) + 줄바꿈 기준
def split_statements(sql):
    parts = re.split(r";[ \t]*(?:--[^\n]*)?(?:\n|$)", sql)
    stmts = []
    for p in parts:
        body = "\n".join(line for line in p.splitlines() if not line.strip().startswith("--")).strip()
        if body:
            stmts.append(p.strip())
    return stmts


# 쓰이는 파라미터만 전달 (문장마다 필요한 키가 다름)
def _params_for(stmt, params):
    if not params:
        return None
    if isinstance(params, dict):
        return {k: v for k, v in params.items() if f"%({k})s" in stmt} or None
    return params


def _run(cur, sql, params, fetch):
    rows = None
    for stmt in split_statements(sql):
        cur.execute(stmt, _params_for(stmt, params))
        if fetch and cur.description:
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    return rows


# 단일 트랜잭션 실행 (실패 시 롤백), 마지막 결과 행 반환
def execute(sql, params=None, fetch=False):
    with closing(get_conn()) as conn:
        with conn, conn.cursor() as cur:
            return _run(cur, sql, params, fetch)


def execute_file(rel_path, params=None, fetch=False):
    return execute(read_sql(rel_path), params, fetch)


# 여러 SQL 파일을 단일 트랜잭션으로 실행 (하나라도 실패하면 전체 롤백)
# steps: [(rel_path, params, fetch)], fetch 결과 첫 행은 다음 단계 params 에 병합
def run_in_transaction(steps):
    results = {}
    with closing(get_conn()) as conn:
        with conn, conn.cursor() as cur:
            for rel_path, params, fetch in steps:
                rows = _run(cur, read_sql(rel_path), {**(params or {}), **results}, fetch)
                if fetch and rows:
                    results.update(rows[0])
    return results
