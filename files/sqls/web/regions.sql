-- 대상 행정동 결과 (현재 게시 기준월, 분류·지표·도로 여건·증가 양상)
SELECT coalesce(json_agg(r ORDER BY r.classification, r.ev_cnt DESC), '[]')
FROM (
    SELECT v.adm_cd, v.sgg_nm, replace(v.adm_nm, '서울특별시 ' || v.sgg_nm || ' ', '') AS adm_nm,
           v.classification, v.quality_grade, v.reason_codes,
           v.ev_cnt, f.prev_ev_cnt, v.ev_yoy_rate, f.ev_yoy_abs, f.is_new_entry, v.ev_share,
           f.link_cnt, f.road_len_km, v.coverage, v.avg_spd, v.speed_cv, v.low_spd_ratio,
           v.charger_hint, v.charger_hint_nm,
           m.growth_pattern, m.inc_12m, m.rate_3m, m.up_months
    FROM mart.v_admdong_result v
    JOIN mart.fact_admdong_indicator f USING (base_month, adm_cd)
    LEFT JOIN mart.v_reg_momentum m USING (adm_cd)
    WHERE v.base_month = (SELECT max(base_month) FROM ops.publish_status WHERE status = 'current')
) r;
