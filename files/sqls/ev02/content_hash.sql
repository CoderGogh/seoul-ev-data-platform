-- 정규화 결과 해시와 직전 적재 비교 (재공표 동일 여부)
SELECT n.row_cnt, n.total_cnt, n.content_hash, p.load_id AS prev_load_id, p.content_hash AS prev_hash
FROM (
    SELECT count(*) AS row_cnt, coalesce(sum(total_cnt), 0) AS total_cnt,
           md5(string_agg(concat_ws('|', adm_cd, fuel_cd, gov_car, gov_van, gov_truck, gov_special,
                                    pvt_car, pvt_van, pvt_truck, pvt_special, biz_car, biz_van, biz_truck,
                                    biz_special, total_cnt), ',' ORDER BY adm_cd, fuel_cd)) AS content_hash
    FROM staging.registration_norm WHERE run_id = %(run_id)s
) n
LEFT JOIN LATERAL (
    SELECT load_id, content_hash FROM ops.reg_load
    WHERE base_month = %(base_month)s ORDER BY loaded_at DESC LIMIT 1
) p ON true;
