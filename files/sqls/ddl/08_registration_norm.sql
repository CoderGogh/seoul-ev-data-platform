-- 등록현황 정규화 작업 테이블 (API·파일 경로 합류 지점, run 단위)

CREATE TABLE IF NOT EXISTS staging.registration_norm (
    run_id          text        NOT NULL,
    base_month      char(6)     NOT NULL,
    adm_cd          char(10)    NOT NULL,
    fuel_cd         text        NOT NULL,
    gov_car int NOT NULL, gov_van int NOT NULL, gov_truck int NOT NULL, gov_special int NOT NULL,
    pvt_car int NOT NULL, pvt_van int NOT NULL, pvt_truck int NOT NULL, pvt_special int NOT NULL,
    biz_car int NOT NULL, biz_van int NOT NULL, biz_truck int NOT NULL, biz_special int NOT NULL,
    total_cnt       int         NOT NULL,
    src_rows        int         NOT NULL,               -- 합산된 원천 행 수 (사용본거지 차이)
    PRIMARY KEY (run_id, adm_cd, fuel_cd)
);

-- 원천 행별 매칭 결과 (정규화·격리가 같은 규칙 사용)
-- 행정동: API는 코드, 파일은 이름(가운뎃점 정규화)으로 활성 경계와 매칭
-- 숫자: 쉼표 제거, 빈 값 0, 계는 세부 합으로 재계산
CREATE OR REPLACE VIEW staging.v_registration_match AS
WITH b AS (
    SELECT a.adm_cd, a.adm_nm
    FROM core.admdong a
    JOIN core.master_version v ON v.master_type = 'boundary' AND v.version = a.boundary_ver AND v.status = 'active'
), r AS (
    SELECT raw.*,
           btrim(raw.adstrd_nm) AS dong_nm,
           coalesce(nullif(replace(btrim(raw.sum_tot), ',', ''), '')::numeric::int, NULL) AS sum_tot_raw,
           ARRAY[raw.sum11, raw.sum12, raw.sum13, raw.sum14, raw.sum21, raw.sum22, raw.sum23, raw.sum24,
                 raw.sum31, raw.sum32, raw.sum33, raw.sum34] AS sums_txt
    FROM staging.registration_raw raw
)
SELECT r.run_id, r.row_no, r.base_month, r.source, r.dong_cd, r.dong_nm, r.fuel_cd AS fuel_cd_raw, r.fuel_nm,
       coalesce(bc.adm_cd, bn.adm_cd) AS adm_cd,
       f.fuel_cd,
       n.v AS sums,
       (SELECT sum(x) FROM unnest(n.v) x)::int AS detail_sum,
       r.sum_tot_raw
FROM r
CROSS JOIN LATERAL (
    SELECT array_agg(coalesce(nullif(replace(btrim(t), ',', ''), '')::numeric::int, 0) ORDER BY i) AS v
    FROM unnest(r.sums_txt) WITH ORDINALITY AS u(t, i)
) n
LEFT JOIN b bc ON bc.adm_cd = r.dong_cd
LEFT JOIN b bn ON r.dong_cd IS NULL AND bn.adm_nm = '서울특별시 ' || replace(r.dong_nm, '.', '·')
LEFT JOIN core.fuel_code f ON f.fuel_cd = coalesce(r.fuel_cd, (SELECT fc.fuel_cd FROM core.fuel_code fc WHERE fc.fuel_nm = btrim(r.fuel_nm)));
