-- 대상 행정동 월별 전기차 대수 (adm_cd → 기준월 순 배열)
SELECT coalesce(json_object_agg(adm_cd, series), '{}')
FROM (
    SELECT adm_cd, json_agg(json_build_object('base_month', base_month, 'ev_cnt', ev_cnt) ORDER BY base_month) AS series
    FROM mart.v_reg_monthly
    GROUP BY adm_cd
) s;
