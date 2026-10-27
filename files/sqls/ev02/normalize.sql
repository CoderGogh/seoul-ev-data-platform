-- 정규화: 매칭된 행만 행정동 × 연료로 합산 (사용본거지 시군구 차이 합산)
DELETE FROM staging.registration_norm WHERE run_id = %(run_id)s;

INSERT INTO staging.registration_norm (
    run_id, base_month, adm_cd, fuel_cd,
    gov_car, gov_van, gov_truck, gov_special, pvt_car, pvt_van, pvt_truck, pvt_special,
    biz_car, biz_van, biz_truck, biz_special, total_cnt, src_rows)
SELECT run_id, base_month, adm_cd, fuel_cd,
       sum(sums[1]), sum(sums[2]), sum(sums[3]), sum(sums[4]), sum(sums[5]), sum(sums[6]),
       sum(sums[7]), sum(sums[8]), sum(sums[9]), sum(sums[10]), sum(sums[11]), sum(sums[12]),
       sum(detail_sum), count(*)
FROM staging.v_registration_match
WHERE run_id = %(run_id)s AND adm_cd IS NOT NULL AND fuel_cd IS NOT NULL
GROUP BY run_id, base_month, adm_cd, fuel_cd;
