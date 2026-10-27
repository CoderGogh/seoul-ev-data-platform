# 보조 스크립트 단위 테스트
from datetime import datetime, timedelta, timezone

import bootstrap_collector
import xlsx_to_json

KST = timezone(timedelta(hours=9))


# 셀 참조 → 열 번호
def test_col_index():
    assert xlsx_to_json.col_index("A1") == 0
    assert xlsx_to_json.col_index("Z9") == 25
    assert xlsx_to_json.col_index("AA10") == 26


# 수집 슬롯 :00, :30 정렬
def test_next_slot_alignment():
    assert bootstrap_collector.next_slot(datetime(2026, 10, 27, 17, 31, 40, tzinfo=KST)) == datetime(
        2026, 10, 27, 18, 0, tzinfo=KST
    )
    assert bootstrap_collector.next_slot(datetime(2026, 10, 27, 17, 59, tzinfo=KST)) == datetime(
        2026, 10, 27, 18, 0, tzinfo=KST
    )
    assert bootstrap_collector.next_slot(datetime(2026, 10, 27, 18, 0, tzinfo=KST)) == datetime(
        2026, 10, 27, 18, 30, tzinfo=KST
    )
