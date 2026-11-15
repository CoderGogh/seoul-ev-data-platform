-- 정제·행정동 귀속 (위치 판정 결과 결합). 귀속 구 ≠ 수집 구: sgg_mismatch, 위치 못 찾음: unlocated
-- 주차장: 주차장 코드당 1행 (노상은 구획마다 원천 1행 → 주차면 합산)
-- 파라미터: run_id, sgg_map (JSON 객체: 구 이름 → 구 코드)
DELETE FROM staging.apt_norm WHERE run_id = %(run_id)s;

INSERT INTO staging.apt_norm (
    run_id, kapt_code, sgg_cd, kapt_name, bjd_code, hh_cnt, dong_cnt, apt_type, use_date, doro_juso,
    boundary_ver, adm_cd, loc_source, assign_status)
WITH b AS (SELECT version FROM core.master_version WHERE master_type = 'boundary' AND status = 'active')
SELECT c.run_id, c.kapt_code, c.sgg_cd,
       nullif(btrim(c.basis_payload->>'kaptName'), ''),
       CASE WHEN c.basis_payload->>'bjdCode' ~ '^[0-9]{10}$' THEN c.basis_payload->>'bjdCode' END,
       c.hh_cnt,
       CASE WHEN c.basis_payload->>'kaptDongCnt' ~ '^[0-9]+$' THEN (c.basis_payload->>'kaptDongCnt')::int END,
       nullif(btrim(c.basis_payload->>'codeAptNm'), ''),
       CASE WHEN c.basis_payload->>'kaptUsedate' ~ '^[0-9]{8}$'
            THEN to_date(c.basis_payload->>'kaptUsedate', 'YYYYMMDD') END,
       nullif(btrim(c.basis_payload->>'doroJuso'), ''),
       b.version, l.adm_cd, coalesce(l.loc_source, 'none'),
       CASE WHEN l.adm_cd IS NULL THEN CASE WHEN coalesce(l.loc_source, 'none') = 'none' THEN 'unlocated' ELSE 'outside' END
