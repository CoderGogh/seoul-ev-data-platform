-- 매칭 실패 행 격리 (사유 코드와 원문 보존)
DELETE FROM quarantine.registration_record WHERE run_id = %(run_id)s;

INSERT INTO quarantine.registration_record (run_id, row_no, base_month, reason_code, raw)
SELECT m.run_id, m.row_no, m.base_month,
       CASE WHEN m.fuel_cd IS NULL THEN 'unknown_fuel'
            WHEN m.dong_nm = '기타' THEN 'etc_dong'          -- 법정동 코드 잔여분
            WHEN m.dong_cd IS NOT NULL THEN 'legacy_dong'    -- 코드는 있으나 활성 경계에 없음 (폐지 동)
            ELSE 'name_unmatched' END,
       to_jsonb(r) - 'run_id'
FROM staging.v_registration_match m
JOIN staging.registration_raw r ON r.run_id = m.run_id AND r.row_no = m.row_no
WHERE m.run_id = %(run_id)s AND (m.adm_cd IS NULL OR m.fuel_cd IS NULL);
