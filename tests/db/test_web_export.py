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


# meta 실행 요약: ev14 자기 실행·진행 중 기록 제외 (매 실행마다 내용이 바뀌어 변경 없음 판정이 안 되는 것 방지)
def test_meta_excludes_self_and_running(cur, supply):
    _publish(cur, "r1")
    cur.execute(
        """INSERT INTO ops.pipeline_run (dag_id, run_id, status, finished_at) VALUES
           ('ev14_web_publish', 'w1', 'published', now()), ('ev14_web_publish', 'w2', 'running', NULL),
           ('ev01_traffic_collect', 'p1', 'running', NULL), ('ev01_traffic_collect', 'p0', 'success', now())"""
    )
    before = _export(cur)["meta"]["pipeline"]
    cur.execute("INSERT INTO ops.pipeline_run (dag_id, run_id, status) VALUES ('ev14_web_publish', 'w3', 'running')")
    after = _export(cur)["meta"]["pipeline"]
    assert before == after
    assert {p["dag_id"] for p in after} == {"ev01_traffic_collect"} and all(p["status"] != "running" for p in after)
