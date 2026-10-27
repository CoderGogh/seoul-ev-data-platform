-- 행정동 지표 후보 (대상 자치구 행정동 전체, 판정 전)
-- 파라미터: run_id, base_month, prev_month, window_start, window_end, target_set, threshold_ver
DELETE FROM mart.candidate_admdong_indicator WHERE run_id = %(run_id)s;

INSERT INTO mart.candidate_admdong_indicator (
    base_month, adm_cd, traffic_window_start, traffic_window_end, period_mismatch,
    ev_cnt, total_cnt, ev_share, prev_ev_cnt, ev_yoy_rate, ev_yoy_abs, is_new_entry,
    link_cnt, road_len_km, valid_timebands, coverage, min_obs, avg_spd, speed_cv, low_spd_ratio,
    quality_grade, classification, b_suppressed, reason_codes, threshold_ver, run_id, published_at)
WITH p AS (SELECT params FROM ops.threshold_version WHERE threshold_ver = %(threshold_ver)s),
dongs AS (  -- 대상 자치구의 활성 경계 행정동 전체 (링크 없는 동도 행 유지)
    SELECT d.adm_cd FROM mart.dim_admdong d
    WHERE d.sgg_nm IN (SELECT DISTINCT a.sgg_nm FROM core.target_link t
                       JOIN core.admdong a ON a.boundary_ver = t.boundary_ver AND a.adm_cd = t.adm_cd
                       WHERE t.target_set = %(target_set)s)
), reg AS (
    SELECT adm_cd,
           sum(total_cnt) FILTER (WHERE base_month = %(base_month)s AND f.is_ev) AS ev,
           sum(total_cnt) FILTER (WHERE base_month = %(base_month)s) AS total,
           sum(total_cnt) FILTER (WHERE base_month = %(prev_month)s AND f.is_ev) AS ev_prev,
           bool_or(base_month = %(prev_month)s) AS has_prev
    FROM core.reg_snapshot s JOIN core.fuel_code f USING (fuel_cd)
    WHERE base_month IN (%(base_month)s, %(prev_month)s)
    GROUP BY adm_cd
), hours AS (
    SELECT count(*) AS n FROM generate_series(date_trunc('hour', %(window_start)s::timestamptz + interval '59 minutes'),
                                              %(window_end)s::timestamptz - interval '1 hour', interval '1 hour') h
    WHERE extract(hour FROM h AT TIME ZONE 'Asia/Seoul') BETWEEN 7 AND 21
), links AS (
    SELECT t.adm_cd, count(*) AS link_cnt, sum(s.length_m) / 1000 AS road_km
    FROM core.target_link t JOIN core.service_link s ON s.link_ver = t.link_ver AND s.service_link_id = t.service_link_id
    WHERE t.target_set = %(target_set)s AND NOT t.is_excluded GROUP BY 1
), obs AS (  -- 분석 기간 주간 확정 관측 (링크-시간)
    SELECT t.adm_cd, count(*) AS link_hours, count(*) FILTER (WHERE lt.rep_spd < (SELECT (params->>'low_spd_kmh')::numeric FROM p)) AS low_cnt
    FROM core.link_timeband lt JOIN core.target_link t ON t.service_link_id = lt.link_id AND t.target_set = %(target_set)s
    WHERE lt.is_final AND lt.timeband BETWEEN 7 AND 21
      AND (lt.obs_date + make_interval(hours => lt.timeband)) AT TIME ZONE 'Asia/Seoul' >= %(window_start)s::timestamptz
      AND (lt.obs_date + make_interval(hours => lt.timeband + 1)) AT TIME ZONE 'Asia/Seoul' <= %(window_end)s::timestamptz
    GROUP BY 1
), tb AS (  -- 시간대 평균 속도 시계열 → 변동계수, 유효 시간대 수
    SELECT c.adm_cd,
           count(*) FILTER (WHERE c.link_cnt >= l.link_cnt * (SELECT (params->>'valid_tb_link_ratio')::numeric FROM p)) AS valid_tb,
           min(c.link_cnt) AS min_obs,
           round(avg(c.avg_spd_len), 1) AS avg_spd,
           round((stddev_pop(c.avg_spd_len) / nullif(avg(c.avg_spd_len), 0))::numeric, 3) AS cv
    FROM mart.candidate_admdong_timeband c JOIN links l USING (adm_cd)
    WHERE c.run_id = %(run_id)s GROUP BY c.adm_cd
)
SELECT %(base_month)s, d.adm_cd, %(window_start)s::timestamptz, %(window_end)s::timestamptz, true,
       r.ev, r.total, round(100.0 * r.ev / nullif(r.total, 0), 3), r.ev_prev,
       CASE WHEN coalesce(r.ev_prev, 0) > 0 THEN round(100.0 * (r.ev - r.ev_prev) / r.ev_prev, 2) END,
       r.ev - coalesce(r.ev_prev, 0),
       r.has_prev AND coalesce(r.ev_prev, 0) = 0 AND coalesce(r.ev, 0) > 0,
       coalesce(l.link_cnt, 0), round(l.road_km::numeric, 2), coalesce(tb.valid_tb, 0),
       round(100.0 * coalesce(o.link_hours, 0) / nullif(l.link_cnt * (SELECT n FROM hours), 0), 2),
       tb.min_obs, tb.avg_spd, tb.cv,
       round(100.0 * o.low_cnt / nullif(o.link_hours, 0), 2),
       'ok', 'REF', true, '{}', %(threshold_ver)s, %(run_id)s, now()
FROM dongs d
LEFT JOIN reg r USING (adm_cd)
LEFT JOIN links l USING (adm_cd)
LEFT JOIN obs o USING (adm_cd)
LEFT JOIN tb USING (adm_cd);
