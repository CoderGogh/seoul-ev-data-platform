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
            WHEN left(l.adm_cd, 5) <> c.sgg_cd THEN 'sgg_mismatch' ELSE 'assigned' END
FROM staging.v_apt_check c
CROSS JOIN b
LEFT JOIN staging.aux_locate l ON l.run_id = c.run_id AND l.src = 'apt' AND l.src_key = c.kapt_code
WHERE c.run_id = %(run_id)s AND c.reason_code IS NULL;

DELETE FROM staging.parking_norm WHERE run_id = %(run_id)s;

INSERT INTO staging.parking_norm (
    run_id, pklt_cd, sgg_cd, pklt_nm, addr, kind_nm, oper_nm, pay_nm, space_cnt, slot_rows,
    boundary_ver, adm_cd, loc_source, assign_status)
WITH b AS (SELECT version FROM core.master_version WHERE master_type = 'boundary' AND status = 'active'),
g AS (
    SELECT c.run_id, c.pklt_cd, (%(sgg_map)s::jsonb ->> min(c.sgg_nm))::char(5) AS sgg_cd,
           min(c.payload->>'PKLT_NM') AS pklt_nm, min(c.addr) AS addr,
           min(c.payload->>'PKLT_KND_NM') AS kind_nm, min(c.payload->>'OPER_SE_NM') AS oper_nm,
           min(c.payload->>'CHGD_FREE_NM') AS pay_nm,
           round(sum(c.space_cnt))::int AS space_cnt, count(*) AS slot_rows
    FROM staging.v_parking_check c
    WHERE c.run_id = %(run_id)s AND c.reason_code IS NULL AND %(sgg_map)s::jsonb ? c.sgg_nm
    GROUP BY c.run_id, c.pklt_cd
)
SELECT g.run_id, g.pklt_cd, g.sgg_cd, g.pklt_nm, g.addr, g.kind_nm, g.oper_nm, g.pay_nm, g.space_cnt, g.slot_rows,
       b.version, l.adm_cd, coalesce(l.loc_source, 'none'),
