-- 검사 실패 행 격리 (사유 코드와 원문 보존)
-- 파라미터: run_id
DELETE FROM quarantine.charger_record WHERE run_id = %(run_id)s;

INSERT INTO quarantine.charger_record (run_id, sgg_cd, row_no, reason_code, raw)
SELECT run_id, sgg_cd, row_no, reason_code, payload
FROM staging.v_charger_check
WHERE run_id = %(run_id)s AND reason_code IS NOT NULL;
