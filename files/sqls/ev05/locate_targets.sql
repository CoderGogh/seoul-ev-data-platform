-- 위치 판정 대상: 검사 통과 단지·주차장의 주소, 주차장 원천 좌표(구획 평균)
-- 파라미터: run_id, sgg_nms
SELECT 'apt' AS src, kapt_code AS src_key,
       nullif(btrim(basis_payload->>'doroJuso'), '') AS road_addr,
       nullif(btrim(basis_payload->>'kaptAddr'), '') AS parcel_addr,
       NULL::float8 AS lng, NULL::float8 AS lat
FROM staging.v_apt_check
WHERE run_id = %(run_id)s AND reason_code IS NULL
UNION ALL
SELECT 'parking', pklt_cd, NULL, min(addr), avg(lng)::float8, avg(lat)::float8
FROM staging.v_parking_check
WHERE run_id = %(run_id)s AND reason_code IS NULL AND sgg_nm = ANY (%(sgg_nms)s)
GROUP BY pklt_cd
ORDER BY 1, 2;
