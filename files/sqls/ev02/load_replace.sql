-- 기준월 파티션 교체 (load_log 와 같은 트랜잭션)
DELETE FROM core.reg_snapshot WHERE base_month = %(base_month)s;

INSERT INTO core.reg_snapshot (
    base_month, adm_cd, fuel_cd,
    gov_car, gov_van, gov_truck, gov_special, pvt_car, pvt_van, pvt_truck, pvt_special,
    biz_car, biz_van, biz_truck, biz_special, total_cnt, load_id)
SELECT base_month, adm_cd, fuel_cd,
       gov_car, gov_van, gov_truck, gov_special, pvt_car, pvt_van, pvt_truck, pvt_special,
       biz_car, biz_van, biz_truck, biz_special, total_cnt, %(load_id)s
FROM staging.registration_norm
WHERE run_id = %(run_id)s;
