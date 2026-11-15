-- 정제·행정동 귀속 (위치 판정 결과 결합). 귀속 구 ≠ 수집 구: sgg_mismatch, 위치 못 찾음: unlocated
-- 주차장: 주차장 코드당 1행 (노상은 구획마다 원천 1행 → 주차면 합산)
-- 파라미터: run_id, sgg_map (JSON 객체: 구 이름 → 구 코드)
DELETE FROM staging.apt_norm WHERE run_id = %(run_id)s;

