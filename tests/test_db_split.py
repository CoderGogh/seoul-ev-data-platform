# SQL 문장 분리 단위 테스트 (psycopg 3 1회 1문장 제약 대응)
from common.db import _params_for, split_statements


def test_split_delete_insert():
    sql = "-- 설명\nDELETE FROM t WHERE a = %(run_id)s;\n\nINSERT INTO t SELECT 1;\n"
    assert split_statements(sql) == ["-- 설명\nDELETE FROM t WHERE a = %(run_id)s", "INSERT INTO t SELECT 1"]


def test_split_trailing_line_comment():
    sql = "INSERT INTO t VALUES (1)\nON CONFLICT DO NOTHING;  -- 설명\n\nDELETE FROM t;\n"
    assert split_statements(sql) == ["INSERT INTO t VALUES (1)\nON CONFLICT DO NOTHING", "DELETE FROM t"]


def test_split_ignores_comment_only_tail():
    assert split_statements("SELECT 1;\n-- 끝\n") == ["SELECT 1"]


def test_params_only_used_keys():
    assert _params_for("SELECT %(a)s", {"a": 1, "b": 2}) == {"a": 1}
    assert _params_for("SELECT 1", {"a": 1}) is None
    assert _params_for("SELECT %s", (1,)) == (1,)
