# ev02 적재 경로 DB 통합 테스트: 신규·동일 재공표 생략·내용 변경 재공표
from common import db

from .conftest import rows

MONTH = "202610"
COLS = ["gov_car", "gov_van", "gov_truck", "gov_special", "pvt_car", "pvt_van", "pvt_truck", "pvt_special",
        "biz_car", "biz_van", "biz_truck", "biz_special"]  # fmt: skip


def _norm(cur, run_id, counts):
    for adm_cd, cnt in counts.items():
        cur.execute(
            f"""INSERT INTO staging.registration_norm (run_id, base_month, adm_cd, fuel_cd, {", ".join(COLS)},
                    total_cnt, src_rows)
                VALUES (%s, %s, %s, 'e', 0, 0, 0, 0, %s, 0, 0, 0, 0, 0, 0, 0, %s, 1)""",
            (run_id, MONTH, adm_cd, cnt, cnt),
        )


def _compare(cur, run_id):
    return db._run(cur, db.read_sql("ev02/content_hash.sql"), {"run_id": run_id, "base_month": MONTH}, True)[0]


# load_log → load_replace 를 같은 트랜잭션에서 (DAG 의 run_in_transaction 과 같은 순서)
def _load(cur, run_id, h):
    p = {"run_id": run_id, "base_month": MONTH, "source": "api", "source_ref": "TbDongFuelCar",
         "row_cnt": h["row_cnt"], "content_hash": h["content_hash"], "quality_grade": "ok"}  # fmt: skip
    res = db._run(cur, db.read_sql("ev02/load_log.sql"), p, True)[0]
    db._run(cur, db.read_sql("ev02/load_replace.sql"), {**p, **res}, False)
    return res


def _snapshot(cur):
    return {
        r["adm_cd"]: r["total_cnt"]
        for r in rows(cur, "SELECT adm_cd, total_cnt FROM core.reg_snapshot WHERE base_month = %s", (MONTH,))
    }


def test_new_identical_and_republished(cur):
    counts = {"1168000001": 100, "1168000002": 50}
    _norm(cur, "r1", counts)
    h1 = _compare(cur, "r1")
    assert h1["prev_hash"] is None
    first = _load(cur, "r1", h1)
    assert first["prev_load_id"] is None and _snapshot(cur) == counts

    # 같은 내용 재공표 → 해시 동일 (DAG 는 적재 생략)
    _norm(cur, "r2", counts)
    h2 = _compare(cur, "r2")
    assert h2["content_hash"] == h2["prev_hash"]

    # 내용 변경 → 차이 기록 후 파티션 교체
    changed = {**counts, "1168000002": 60}
    _norm(cur, "r3", changed)
    h3 = _compare(cur, "r3")
    assert h3["content_hash"] != h3["prev_hash"]
    third = _load(cur, "r3", h3)
    assert third["prev_load_id"] == first["load_id"]
    assert _snapshot(cur) == changed
    diff = rows(cur, "SELECT diff FROM ops.reg_load WHERE load_id = %s", (third["load_id"],))[0]["diff"]
    assert diff["changed_dongs"] == 1 and diff["total_prev"] == 150
