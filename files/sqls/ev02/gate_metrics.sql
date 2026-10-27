-- 스냅샷 품질 지표 (snapshot_gate 판정 입력)
SELECT
    (SELECT count(DISTINCT adm_cd) FROM staging.registration_norm WHERE run_id = %(run_id)s) AS mapped_dongs,
    (SELECT count(*) FROM mart.dim_admdong) AS active_dongs,
    (SELECT coalesce(sum(total_cnt), 0) FROM staging.registration_norm WHERE run_id = %(run_id)s) AS total_cnt,
    (SELECT count(*) FROM staging.registration_raw WHERE run_id = %(run_id)s) AS raw_rows,
    (SELECT count(*) FROM quarantine.registration_record WHERE run_id = %(run_id)s) AS quarantine_rows,
    (SELECT coalesce(sum(detail_sum), 0) FROM staging.v_registration_match
      WHERE run_id = %(run_id)s AND (adm_cd IS NULL OR fuel_cd IS NULL)) AS quarantine_cnt,
    (SELECT count(*) FROM staging.v_registration_match
      WHERE run_id = %(run_id)s AND sum_tot_raw IS NOT NULL AND sum_tot_raw <> detail_sum) AS sum_tot_mismatch,
    (SELECT count(*) FROM staging.registration_norm WHERE run_id = %(run_id)s AND src_rows > 1) AS merged_keys;
