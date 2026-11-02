-- 충전기 공급 현황 (ev04 최신 상태, 대상 행정동 귀속분) + 수집 품질
WITH ld AS (SELECT * FROM ops.charger_load ORDER BY loaded_at DESC LIMIT 1),
run AS (SELECT run_id FROM ld),
cur AS (SELECT * FROM core.charger WHERE valid_to IS NULL),
f AS (  -- 게시 기준월 지표 (전기차 대수)
    SELECT i.adm_cd, i.ev_cnt, i.classification FROM mart.fact_admdong_indicator i
    WHERE i.base_month = (SELECT max(base_month) FROM ops.publish_status WHERE status = 'current')
), dong AS (
    SELECT f.adm_cd, replace(d.adm_nm, '서울특별시 ' || d.sgg_nm || ' ', '') AS adm_nm, d.sgg_nm, f.ev_cnt, f.classification,
           count(c.stat_id) AS chargers,
           count(DISTINCT c.stat_id) AS stations,
           count(c.stat_id) FILTER (WHERE c.is_fast) AS fast,
           count(c.stat_id) FILTER (WHERE c.limit_yn = 'N') AS open_cnt
    FROM f JOIN mart.dim_admdong d USING (adm_cd)
    LEFT JOIN cur c ON c.adm_cd = f.adm_cd AND c.assign_status = 'assigned'
    GROUP BY 1, 2, 3, 4, 5
)
SELECT json_build_object(
    'snapshot_date', ld.snapshot_date,
    'loaded_at', ld.loaded_at,
    'source', '한국환경공단 전기자동차 충전소 정보 (공공데이터포털 15076352)',
    'load', json_build_object('row_cnt', ld.row_cnt, 'new_cnt', ld.new_cnt, 'changed_cnt', ld.changed_cnt,
                              'closed_cnt', ld.closed_cnt, 'quality_grade', ld.quality_grade),
    'status', (SELECT json_object_agg(assign_status, n) FROM (
                   SELECT assign_status, count(*) AS n FROM cur GROUP BY 1) s),
    'quality', (SELECT json_agg(json_build_object('check', check_name, 'scope', scope_key, 'grade', grade,
                                                  'metric', metric, 'threshold', threshold) ORDER BY check_name, scope_key)
                FROM ops.quality_result q WHERE q.run_id = (SELECT run_id FROM run)),
    'by_sgg', (SELECT json_agg(g ORDER BY g.sgg_nm) FROM (
                   SELECT sgg_nm, sum(chargers) AS chargers, sum(stations) AS stations, sum(fast) AS fast,
                          sum(open_cnt) AS open_cnt, sum(ev_cnt) AS ev_cnt
                   FROM dong GROUP BY 1) g),
    'by_dong', (SELECT json_agg(json_build_object(
                    'adm_cd', adm_cd, 'adm_nm', adm_nm, 'sgg_nm', sgg_nm, 'classification', classification,
                    'ev_cnt', ev_cnt, 'chargers', chargers, 'stations', stations, 'fast', fast, 'open_cnt', open_cnt,
                    'ev_per_charger', round(ev_cnt::numeric / nullif(chargers, 0), 2),
                    'ev_per_fast', round(ev_cnt::numeric / nullif(fast, 0), 1)) ORDER BY adm_cd)
                FROM dong)
)
FROM ld;
