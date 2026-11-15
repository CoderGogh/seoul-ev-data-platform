-- 검사 실패 행 격리 (사유 코드와 원문 보존). 주차장은 대상 구만
-- 파라미터: run_id, sgg_nms
DELETE FROM quarantine.aux_record WHERE run_id = %(run_id)s;

INSERT INTO quarantine.aux_record (run_id, src, row_key, reason_code, raw)
SELECT run_id, 'apt', sgg_cd || ':' || row_no, reason_code,
       jsonb_build_object('list', list_payload, 'basis', basis_payload)
FROM staging.v_apt_check
WHERE run_id = %(run_id)s AND reason_code IS NOT NULL;

INSERT INTO quarantine.aux_record (run_id, src, row_key, reason_code, raw)
SELECT run_id, 'parking', row_no::text, reason_code, payload
FROM staging.v_parking_check
WHERE run_id = %(run_id)s AND reason_code IS NOT NULL AND sgg_nm = ANY (%(sgg_nms)s);
