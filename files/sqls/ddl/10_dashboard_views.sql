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
