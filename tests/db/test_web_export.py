# 웹 내보내기 SQL: 실제 게시 결과에서 JSON 생성 → ev14 묶음 검증 통과 (스키마 변경 시 웹 데이터 깨짐 방지)
from common import db, web_bundle

from .test_ev03_publish import _publish


def _export(cur):
    out = {}
    for name in web_bundle.names():
        rows = db._run(cur, db.read_sql(f"web/{name}.sql"), None, True)
        out[name] = next(iter(rows[0].values())) if rows else None
    return out


def test_web_bundle_from_published(cur, supply):
    _publish(cur, "r1")
    b = _export(cur)
    assert web_bundle.validate(b) == []
    assert b["meta"]["threshold"]["ver"] == "mvp_v3" and "exported_at" not in b["meta"]
    a = next(r for r in b["regions"] if r["adm_cd"] == "1168000001")
    assert a["classification"] == "A" and a["charger_cnt"] == 10 and a["supply_gap"] is True


def test_web_bundle_rejects_unpublished(cur, supply):
    b = _export(cur)
    assert b["meta"] is None or web_bundle.validate(b)
