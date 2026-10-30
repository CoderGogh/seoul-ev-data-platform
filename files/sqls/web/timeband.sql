-- 대상 행정동 시간대별 평균 속도 (현재 게시 기준월, 도로 길이 가중)
SELECT coalesce(json_object_agg(adm_cd, series), '{}')
FROM (
    SELECT t.adm_cd,
           json_agg(json_build_object('timeband', t.timeband, 'label', d.label, 'avg_spd', t.avg_spd_len,
                                      'link_cnt', t.link_cnt) ORDER BY t.timeband) AS series
    FROM mart.fact_admdong_timeband t
    JOIN mart.dim_timeband d USING (timeband)
    WHERE t.base_month = (SELECT max(base_month) FROM ops.publish_status WHERE status = 'current')
    GROUP BY t.adm_cd
) s;
