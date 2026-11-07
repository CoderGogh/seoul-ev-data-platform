-- 등록 추세 보조 지표 (기준월 포함 최근 13개월): 이상 증가 플래그·단순 예측. 분류 판정에는 미사용
-- 한 달 몰림(concentrated): 1년 증가 20대 이상, 증가한 달 합 중 최대 한 달이 절반 이상 (법인·렌터카 대량 등록 의심)
-- 최근 가속(accelerating): 최근 3개월 증가율 10퍼센트 이상이고 직전 3개월의 1.5배 이상
-- 예측: 기준월 + 최근 6개월 월 증가 중앙값 × 개월 (한 달 몰림 영향 완화, 0 미만 금지)
-- 파라미터: run_id, base_month
WITH mon AS (
    SELECT s.adm_cd, s.base_month, sum(s.total_cnt) FILTER (WHERE f.is_ev) AS ev,
           (extract(year FROM age(to_date(%(base_month)s, 'YYYYMM'), to_date(s.base_month, 'YYYYMM'))) * 12
            + extract(month FROM age(to_date(%(base_month)s, 'YYYYMM'), to_date(s.base_month, 'YYYYMM'))))::int AS ago
    FROM core.reg_snapshot s JOIN core.fuel_code f USING (fuel_cd)
    WHERE s.base_month BETWEEN to_char(to_date(%(base_month)s, 'YYYYMM') - interval '12 months', 'YYYYMM')
                           AND %(base_month)s
    GROUP BY 1, 2
), inc AS (
    SELECT m.*, ev - lag(ev) OVER (PARTITION BY adm_cd ORDER BY base_month) AS d,
           lag(ago) OVER (PARTITION BY adm_cd ORDER BY base_month) - ago AS gap  -- 1이 아니면 결측월 있음
    FROM mon m
), a AS (
    SELECT adm_cd, count(*) AS months,
           max(ev) FILTER (WHERE ago = 0) AS ev0, max(ev) FILTER (WHERE ago = 3) AS ev3,
           max(ev) FILTER (WHERE ago = 6) AS ev6, max(ev) FILTER (WHERE ago = 12) AS ev12,
           max(d) AS max_inc, sum(d) FILTER (WHERE d > 0) AS pos_inc,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY d) FILTER (WHERE ago < 6 AND gap = 1) AS med6,
           count(*) FILTER (WHERE ago < 6 AND gap = 1) AS n6
    FROM inc GROUP BY adm_cd
), r AS (
    SELECT adm_cd, months, ev0, med6, n6, ev0 - ev12 AS inc_12m,
           round(100.0 * max_inc / nullif(pos_inc, 0), 1) AS share,
           round(100.0 * (ev0 - ev3) / nullif(ev3, 0), 1) AS r3,
           round(100.0 * (ev3 - ev6) / nullif(ev6, 0), 1) AS r_prev
    FROM a
)
UPDATE mart.candidate_admdong_indicator c
SET max_month_share = r.share,
    rate_3m = r.r3,
    growth_flags = CASE WHEN r.months < 13 THEN '{}'::text[] ELSE array_remove(ARRAY[
        CASE WHEN r.inc_12m >= 20 AND r.share >= 50 THEN 'concentrated' END,
        CASE WHEN r.r3 >= 10 AND r.r3 >= 1.5 * greatest(r.r_prev, 0) THEN 'accelerating' END], NULL) END,
    ev_fcst_3m = CASE WHEN r.n6 = 6 THEN greatest(0, round(r.ev0 + 3 * r.med6))::int END,
    ev_fcst_6m = CASE WHEN r.n6 = 6 THEN greatest(0, round(r.ev0 + 6 * r.med6))::int END
FROM r
WHERE c.run_id = %(run_id)s AND c.adm_cd = r.adm_cd;
