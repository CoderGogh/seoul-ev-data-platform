# 실제 pg_dump·pg_restore: 테스트 DB 덤프 → 임시 DB 복원 → 목차 테이블 확인, 손상 파일 실패
import os
import shutil
from datetime import datetime
from urllib.parse import urlparse

import pytest
from common import backup as b

DB_URL = os.environ.get("EV_TEST_DB_URL")

pytestmark = pytest.mark.skipif(not DB_URL or not shutil.which("pg_dump"), reason="테스트 DB·pg_dump 필요")


@pytest.fixture
def info():
    u = urlparse(DB_URL)
    return {"host": u.hostname, "port": u.port or 5432, "user": u.username, "password": u.password,
            "dbname": u.path.lstrip("/")}  # fmt: skip


def test_dump_and_restore(info, tmp_path):
    path = b.dump(info, tmp_path, datetime(2026, 11, 15, 2, 0))
    assert path.name == f"{info['dbname']}_20261115T0200.dump" and path.stat().st_size > 0
    res = b.restore_check(path, info, restore_db="ev_restore_test")
    assert res["tables"] > 0 and res["missing"] == []
    assert "ops.pipeline_run" in res["counts"]


def test_corrupt_dump_fails(info, tmp_path):
    bad = tmp_path / "bad.dump"
    bad.write_bytes(b"not a dump")
    with pytest.raises(RuntimeError):
        b.restore_check(bad, info, restore_db="ev_restore_test")
