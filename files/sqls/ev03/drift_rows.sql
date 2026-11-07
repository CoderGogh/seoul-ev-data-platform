-- 분포 비교 행: 후보(run_id) + 직전 게시 (같은 기준월 있으면 그 파티션, 없으면 이전 최신 기준월)
-- 파라미터: run_id, base_month
WITH base AS (
    SELECT coalesce(
        (SELECT base_month FROM mart.fact_admdong_indicator WHERE base_month = %(base_month)s LIMIT 1),
        (SELECT max(base_month) FROM mart.fact_admdong_indicator WHERE base_month < %(base_month)s)
    ) AS base_month
)
SELECT 'cand' AS side, %(base_month)s AS base_month, adm_cd, classification,
       ev_cnt, ev_yoy_rate, speed_cv, ev_per_charger
FROM mart.candidate_admdong_indicator WHERE run_id = %(run_id)s
UNION ALL
SELECT 'prev', f.base_month, f.adm_cd, f.classification, f.ev_cnt, f.ev_yoy_rate, f.speed_cv, f.ev_per_charger
FROM mart.fact_admdong_indicator f JOIN base USING (base_month);
