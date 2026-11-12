# 백업 파일명·보관 정리·덤프 목차 해석·비밀번호 비노출 단위 테스트
from datetime import datetime

import pytest
from common import backup as b

FAKE_PW = "-".join(["not", "real"])  # 가짜 값 (비밀값 탐지 오탐 방지)
INFO = {"host": "db", "port": 5432, "user": "ev", "password": FAKE_PW, "dbname": "ev_platform"}
TOC = """;
; Archive created at 2026-11-10 02:00:01 KST
2; 3079 16385 EXTENSION - postgis -
5000; 0 16400 TABLE DATA core admdong ev
5001; 0 16410 TABLE DATA ops pipeline_run ev
5002; 0 16420 TABLE DATA core traffic_obs_202611 ev
6000; 2606 16430 CONSTRAINT core admdong admdong_pkey ev
"""


def test_backup_name():
    assert b.backup_name("ev_platform", datetime(2026, 11, 15, 2, 0)) == "ev_platform_20261115T0200.dump"


# 오래된 순 삭제, 다른 DB·임시·기타 파일 제외
def test_expired():
    names = [f"ev_platform_2026110{d}T0200.dump" for d in range(1, 7)]
    others = ["ev_test_20261101T0200.dump", "ev_platform_20261107T0200.dump.partial", "memo.txt"]
    assert b.expired(names + others, "ev_platform", 4) == names[:2]
    assert b.expired(names, "ev_platform", 10) == []


def test_prune(tmp_path):
    for d in range(1, 6):
        (tmp_path / f"ev_platform_2026110{d}T0200.dump").write_bytes(b"x")
    (tmp_path / "ev_test_20261101T0200.dump").write_bytes(b"x")
    res = b.prune(tmp_path, "ev_platform", 3)
    assert res["removed"] == ["ev_platform_20261101T0200.dump", "ev_platform_20261102T0200.dump"]
    assert len(res["kept"]) == 3 and (tmp_path / "ev_test_20261101T0200.dump").exists()


def test_toc_tables(monkeypatch):
    monkeypatch.setattr(b, "_run", lambda cmd, info: TOC)
    assert b.toc_tables("x.dump", INFO) == ["core.admdong", "core.traffic_obs_202611", "ops.pipeline_run"]


# 클라이언트가 서버보다 새 버전이면 덤프 전 중단
def test_newer_client_rejected(monkeypatch, tmp_path):
    monkeypatch.setattr(b, "versions", lambda info: (18, 16))
    with pytest.raises(RuntimeError, match="pg_dump 18"):
        b.dump(INFO, tmp_path, datetime(2026, 11, 15, 2, 0))
    monkeypatch.setattr(b, "versions", lambda info: (16, 16))
    monkeypatch.setattr(b, "_run", lambda cmd, info: "")
    with pytest.raises(FileNotFoundError):  # 버전 통과 → 덤프 단계 진입
        b.dump(INFO, tmp_path, datetime(2026, 11, 15, 2, 0))


# 서버 주 버전 디렉터리 우선, 없으면 PATH 기본
def test_pg_bin(monkeypatch, tmp_path):
    (tmp_path / "16" / "bin").mkdir(parents=True)
    (tmp_path / "16" / "bin" / "pg_dump").write_text("")
    monkeypatch.setattr(b, "PG_LIB", tmp_path)
    assert b.pg_bin("pg_dump", 16) == str(tmp_path / "16" / "bin" / "pg_dump")
    assert b.pg_bin("pg_dump", 15) == "pg_dump"
    assert b.pg_bin("pg_restore", None) == "pg_restore"


# 비밀번호는 환경변수로만, 명령줄·오류 메시지 미포함
def test_password_not_in_args(monkeypatch, tmp_path):
    seen = {}

    class Res:
        returncode, stdout, stderr = 1, "", "connection refused"

    def fake_run(cmd, env, **kw):
        seen.update(cmd=cmd, env=env)
        return Res()

    monkeypatch.setattr(b, "check_versions", lambda info: None)
    monkeypatch.setattr(b.subprocess, "run", fake_run)
    with pytest.raises(RuntimeError) as e:
        b.dump(INFO, tmp_path, datetime(2026, 11, 15, 2, 0))
    assert FAKE_PW not in " ".join(seen["cmd"]) and seen["env"]["PGPASSWORD"] == FAKE_PW
    assert FAKE_PW not in str(e.value)
    assert not list(tmp_path.iterdir())  # 실패 시 임시 파일 정리
