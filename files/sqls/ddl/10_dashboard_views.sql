-- 대시보드 조회용 view (Rshiny 읽기 전용 계정은 mart·ops 만 접근, view 는 소유자 권한으로 core 조회)

-- 대상 행정동 전동화 규모·추세 (최신 기준월 vs 전년 동월), 게시 전에도 조회 가능
CREATE OR REPLACE VIEW mart.v_reg_trend AS
WITH m AS (SELECT max(base_month) AS cur FROM core.reg_snapshot),
t AS (SELECT DISTINCT adm_cd FROM core.target_link)
SELECT d.sgg_nm, d.adm_nm, d.adm_cd, m.cur AS base_month,
       sum(s.total_cnt) FILTER (WHERE s.base_month = m.cur AND f.is_ev) AS ev_cnt,
       sum(s.total_cnt) FILTER (WHERE s.base_month = to_char(to_date(m.cur, 'YYYYMM') - interval '1 year', 'YYYYMM')
                                  AND f.is_ev) AS prev_ev_cnt,
       sum(s.total_cnt) FILTER (WHERE s.base_month = m.cur) AS total_cnt
FROM m
JOIN core.reg_snapshot s ON true
JOIN core.fuel_code f USING (fuel_cd)
JOIN mart.dim_admdong d ON d.adm_cd = s.adm_cd
WHERE s.adm_cd IN (SELECT adm_cd FROM t)
GROUP BY d.sgg_nm, d.adm_nm, d.adm_cd, m.cur;

-- 행정동 × 날짜 × 시간대 평균 속도 (확정 시간대, 도로 길이 가중), 수집 진행 상황 확인용
CREATE OR REPLACE VIEW mart.v_timeband_profile AS
SELECT a.sgg_nm, a.adm_nm, t.adm_cd, lt.obs_date, lt.timeband,
       round(sum(lt.rep_spd * s.length_m) / nullif(sum(s.length_m), 0), 1) AS avg_spd,
       count(*) AS link_cnt
FROM core.link_timeband lt
JOIN core.target_link t ON t.service_link_id = lt.link_id
JOIN core.service_link s ON s.link_ver = t.link_ver AND s.service_link_id = t.service_link_id
JOIN mart.dim_admdong a ON a.adm_cd = t.adm_cd
WHERE lt.is_final
GROUP BY a.sgg_nm, a.adm_nm, t.adm_cd, lt.obs_date, lt.timeband;

-- 활성 분류 임계값 (그래프 기준선)
CREATE OR REPLACE VIEW mart.v_active_threshold AS
SELECT threshold_ver, basis, (params->>'a_min_ev_cnt')::int AS a_min_ev_cnt,
       (params->>'a_min_yoy_rate')::numeric AS a_min_yoy_rate, params
FROM ops.threshold_version WHERE is_active;

-- 대상 행정동 월별 전기차 대수 (적재된 전체 기준월), 추세 그래프용
CREATE OR REPLACE VIEW mart.v_reg_monthly AS
SELECT d.sgg_nm, d.adm_nm, s.adm_cd, s.base_month,
       sum(s.total_cnt) FILTER (WHERE f.is_ev) AS ev_cnt
FROM core.reg_snapshot s
JOIN core.fuel_code f USING (fuel_cd)
JOIN mart.dim_admdong d ON d.adm_cd = s.adm_cd
WHERE s.adm_cd IN (SELECT DISTINCT adm_cd FROM core.target_link)
GROUP BY d.sgg_nm, d.adm_nm, s.adm_cd, s.base_month;

-- 최근 12개월 증가 양상 (보조 지표, 분류 판정에는 미사용)
-- 한 달 몰림: 1년 증가(20대 이상) 중 증가한 달 합의 절반 이상이 한 달에 / 최근 가속: 최근 3개월 증가율이 직전 3개월의 1.5배 이상이고 10% 이상
CREATE OR REPLACE VIEW mart.v_reg_momentum AS
WITH m AS (SELECT max(base_month) AS cur FROM core.reg_snapshot),
w AS (
    SELECT r.*, r.ev_cnt - lag(r.ev_cnt) OVER (PARTITION BY r.adm_cd ORDER BY r.base_month) AS inc
    FROM mart.v_reg_monthly r, m
    WHERE r.base_month >= to_char(to_date(m.cur, 'YYYYMM') - interval '1 year', 'YYYYMM')
), a AS (
    SELECT w.sgg_nm, w.adm_nm, w.adm_cd, m.cur AS base_month,
           count(*) AS months,
           max(w.ev_cnt) FILTER (WHERE w.base_month = m.cur) AS ev_cnt,
           max(w.ev_cnt) FILTER (WHERE w.base_month = to_char(to_date(m.cur, 'YYYYMM') - interval '3 months', 'YYYYMM')) AS ev_3m,
           max(w.ev_cnt) FILTER (WHERE w.base_month = to_char(to_date(m.cur, 'YYYYMM') - interval '6 months', 'YYYYMM')) AS ev_6m,
           max(w.ev_cnt) FILTER (WHERE w.base_month = to_char(to_date(m.cur, 'YYYYMM') - interval '1 year', 'YYYYMM')) AS ev_12m,
           count(*) FILTER (WHERE w.inc > 0) AS up_months,
           max(w.inc) AS max_inc,
           sum(w.inc) FILTER (WHERE w.inc > 0) AS pos_inc   -- 감소 달 제외한 증가 합
    FROM w, m GROUP BY w.sgg_nm, w.adm_nm, w.adm_cd, m.cur
), r AS (
    SELECT a.*, ev_cnt - ev_12m AS inc_12m,
           round(100.0 * (ev_cnt - ev_3m) / nullif(ev_3m, 0), 1) AS rate_3m,
           round(100.0 * (ev_3m - ev_6m) / nullif(ev_6m, 0), 1) AS rate_prev_3m,
           round(100.0 * max_inc / nullif(pos_inc, 0)) AS max_month_share
    FROM a
)
SELECT r.*,
       CASE WHEN months < 13 OR ev_12m IS NULL THEN NULL           -- 12개월 이력 부족
            WHEN inc_12m >= 20 AND max_month_share >= 50 THEN '한 달 몰림'  -- 증가 20대 미만은 잡음
            WHEN rate_3m >= 10 AND rate_3m >= 1.5 * greatest(rate_prev_3m, 0) THEN '최근 가속'
            WHEN up_months >= 10 THEN '꾸준한 증가'
            ELSE '정체·변동' END AS growth_pattern
FROM r;
