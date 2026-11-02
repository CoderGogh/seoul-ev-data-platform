-- 품질 게이트 지표: 원천·격리·삭제 표시·정제·귀속 건수
-- 파라미터: run_id
SELECT (SELECT count(*) FROM staging.charger_raw WHERE run_id = %(run_id)s) AS raw_rows,
       count(*) FILTER (WHERE c.reason_code IS NOT NULL) AS quarantine_rows,
       count(*) FILTER (WHERE c.reason_code IS NULL AND c.is_deleted) AS deleted_rows,
       (SELECT count(*) FROM staging.charger_norm WHERE run_id = %(run_id)s) AS norm_rows,
       (SELECT count(*) FROM staging.charger_norm
        WHERE run_id = %(run_id)s AND assign_status = 'assigned') AS assigned_rows,
       (SELECT count(*) FROM staging.charger_norm
        WHERE run_id = %(run_id)s AND assign_status = 'sgg_mismatch') AS sgg_mismatch_rows,
       (SELECT count(*) FROM staging.charger_norm
        WHERE run_id = %(run_id)s AND is_fast IS NULL) AS unknown_type_rows
FROM staging.v_charger_check c
WHERE c.run_id = %(run_id)s;
