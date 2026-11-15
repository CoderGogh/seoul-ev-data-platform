-- 수집일 스냅샷 교체 (같은 날 재실행 멱등)
-- 파라미터: run_id, snapshot_date, load_id
DELETE FROM core.apt_complex WHERE snapshot_date = %(snapshot_date)s::date;

INSERT INTO core.apt_complex (snapshot_date, kapt_code, sgg_cd, kapt_name, bjd_code, hh_cnt, dong_cnt, apt_type,
                              use_date, doro_juso, boundary_ver, adm_cd, loc_source, assign_status, load_id)
SELECT %(snapshot_date)s::date, kapt_code, sgg_cd, kapt_name, bjd_code, hh_cnt, dong_cnt, apt_type, use_date,
       doro_juso, boundary_ver, adm_cd, loc_source, assign_status, %(load_id)s
FROM staging.apt_norm WHERE run_id = %(run_id)s;

DELETE FROM core.public_parking WHERE snapshot_date = %(snapshot_date)s::date;

