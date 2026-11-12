# 분석 DB 백업: pg_dump 덤프, 임시 DB 복원 리허설, 보관 개수 정리
import os
import re
import subprocess
from contextlib import closing
from pathlib import Path

import psycopg

BACKUP_DIR = Path(os.environ.get("EV_BACKUP_DIR", "/opt/airflow/files/backups"))
FILE_RE = re.compile(r"^(?P<db>[A-Za-z0-9_]+)_(?P<ts>\d{8}T\d{4})\.dump$")
TOC_DATA_RE = re.compile(r"^\d+; \d+ \d+ TABLE DATA (?P<schema>\S+) (?P<table>\S+) ")
RESTORE_DB = "ev_restore_check"
PG_LIB = Path(os.environ.get("EV_PG_LIB", "/usr/lib/postgresql"))


# 접속 정보 (Airflow Connection → dict)
def conninfo_from_airflow(conn_id):
    from airflow.sdk import BaseHook

    c = BaseHook.get_connection(conn_id)
    return {"host": c.host, "port": c.port or 5432, "user": c.login, "password": c.password, "dbname": c.schema}


# 비밀번호는 환경변수로만 전달 (명령줄·로그 미노출)
def _env(info):
    return {**os.environ, "PGPASSWORD": info["password"] or ""}


def _base_args(info, dbname=None):
    return ["-h", str(info["host"]), "-p", str(info["port"]), "-U", info["user"], "-d", dbname or info["dbname"]]


def _run(cmd, info):
    res = subprocess.run(cmd, env=_env(info), capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"{cmd[0]} 실패 (code {res.returncode}): {res.stderr.strip()[-2000:]}")
    return res.stdout


# 백업 파일명 (DB명_KST시각.dump)
def backup_name(dbname, ts):
    return f"{dbname}_{ts:%Y%m%dT%H%M}.dump"


# 서버 주 버전
def server_major(info):
    with closing(psycopg.connect(**info)) as conn:
        return int(conn.execute("SHOW server_version_num").fetchone()[0]) // 10000


# 서버 주 버전 맞춤 클라이언트 (Debian 다중 설치, 없으면 PATH 기본)
def pg_bin(name, major):
    path = PG_LIB / str(major) / "bin" / name
    return str(path) if major and path.exists() else name


# 클라이언트·서버 주 버전 (새 버전 pg_dump 덤프는 옛 서버에 복원 불가)
def versions(info):
    server = server_major(info)
    out = subprocess.run([pg_bin("pg_dump", server), "--version"], capture_output=True, text=True, check=True).stdout
    client = int(re.search(r"\(PostgreSQL\) (\d+)", out).group(1))
    return client, server


def check_versions(info):
    client, server = versions(info)
    if client > server:
        raise RuntimeError(f"pg_dump {client} > 서버 {server}: 같은 서버 복원 불가, 클라이언트 버전 맞춤 필요")
    return server


# custom 형식 덤프, 임시 파일 → 완료 후 이름 확정
def dump(info, out_dir, ts):
    major = check_versions(info)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    final = out_dir / backup_name(info["dbname"], ts)
    tmp = final.with_suffix(".dump.partial")
    try:
        _run([pg_bin("pg_dump", major), *_base_args(info), "-Fc", "-f", str(tmp)], info)
        tmp.rename(final)
    finally:
        tmp.unlink(missing_ok=True)
    return final


# 덤프 목차의 데이터 테이블 (schema.table)
def toc_tables(path, info, major=None):
    out = _run([pg_bin("pg_restore", major), "-l", str(path)], info)
    return sorted({f"{m['schema']}.{m['table']}" for line in out.splitlines() if (m := TOC_DATA_RE.match(line))})


def _admin(info, sql):
    with closing(psycopg.connect(**{**info, "dbname": "postgres"}, autocommit=True)) as conn:
        conn.execute(sql)


# 임시 DB 복원 → 목차 테이블 존재·행 수 확인 → 임시 DB 삭제
def restore_check(path, info, restore_db=RESTORE_DB):
    major = server_major(info)
    expected = toc_tables(path, info, major)
    _admin(info, f"DROP DATABASE IF EXISTS {restore_db}")
    _admin(info, f"CREATE DATABASE {restore_db} TEMPLATE template0")
    try:
        _run(
            [pg_bin("pg_restore", major), *_base_args(info, restore_db), "--exit-on-error", "--no-owner", str(path)],
            info,
        )
        counts, missing = {}, []
        with closing(psycopg.connect(**{**info, "dbname": restore_db})) as conn:
            for name in expected:
                schema, table = name.split(".", 1)
                if conn.execute("SELECT to_regclass(%s)", (f'"{schema}"."{table}"',)).fetchone()[0] is None:
                    missing.append(name)
                    continue
                counts[name] = conn.execute(f'SELECT count(*) FROM "{schema}"."{table}"').fetchone()[0]
    finally:
        _admin(info, f"DROP DATABASE IF EXISTS {restore_db}")
    return {"tables": len(expected), "missing": missing, "rows": sum(counts.values()), "counts": counts}


# 보관 개수 초과분 (같은 DB 백업만, 오래된 순)
def expired(names, dbname, keep):
    mine = sorted(n for n in names if (m := FILE_RE.match(n)) and m["db"] == dbname)
    return mine[: max(len(mine) - keep, 0)]


def prune(out_dir, dbname, keep):
    out_dir = Path(out_dir)
    names = [p.name for p in out_dir.iterdir() if p.is_file()] if out_dir.exists() else []
    removed = expired(names, dbname, keep)
    for n in removed:
        (out_dir / n).unlink()
    kept = sorted(set(n for n in names if (m := FILE_RE.match(n)) and m["db"] == dbname) - set(removed))
    return {"removed": removed, "kept": kept}
