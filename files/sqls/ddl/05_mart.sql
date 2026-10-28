-- mart: 게시 결과 (행정동 × 기준월, 파티션 교체로 게시)

-- 행정동 종합 지표·분류
CREATE TABLE IF NOT EXISTS mart.fact_admdong_indicator (
    base_month           char(6)     NOT NULL,
    adm_cd               char(10)    NOT NULL,
    traffic_window_start timestamptz NOT NULL,
    traffic_window_end   timestamptz NOT NULL,
    period_mismatch      boolean     NOT NULL,          -- 등록 기준월 ≠ 도로 분석 기간
    -- 전동화 규모·추세
    ev_cnt               int,
    total_cnt            int,
    ev_share             numeric(6, 3),                 -- 침투율 % (보조)
    prev_ev_cnt          int,                           -- 전년 동월
    ev_yoy_rate          numeric(7, 2),                 -- 증가율 % (전년 0이면 NULL)
    ev_yoy_abs           int,                           -- 절대 증가량
    is_new_entry         boolean,                       -- 전년 0 → 신규 진입
    -- 도로 환경
    link_cnt             int,
    road_len_km          numeric(8, 2),
    valid_timebands      int,
    coverage             numeric(5, 2),                 -- 링크-시간 유효 관측 %
    min_obs              int,                           -- 시간대별 최소 관측 링크 수
    avg_spd              numeric(6, 1),                 -- 도로 길이 가중
    speed_cv             numeric(6, 3),                 -- 시간대별 평균 속도 변동계수
    low_spd_ratio        numeric(5, 2),                 -- 저속 관측 비중 % (보조)
    -- 품질·분류
    quality_grade        text        NOT NULL CHECK (quality_grade IN ('ok', 'warn', 'below', 'fatal')),
    classification       text        NOT NULL CHECK (classification IN ('A', 'B', 'C', 'REF', 'WITHHELD')),
    b_suppressed         boolean     NOT NULL,          -- 원천 갱신 미검증으로 B 비활성
    reason_codes         text[]      NOT NULL DEFAULT '{}',
    threshold_ver        text        NOT NULL,
    run_id               text        NOT NULL,
    published_at         timestamptz NOT NULL,
    charger_hint         text        CHECK (charger_hint IN ('fast', 'slow', 'mixed')),  -- 충전소 유형 참고 (도로 저속 비율)
    PRIMARY KEY (base_month, adm_cd)
);

-- 행정동 시간대별 평균 속도
CREATE TABLE IF NOT EXISTS mart.fact_admdong_timeband (
    base_month      char(6)     NOT NULL,
    adm_cd          char(10)    NOT NULL,
    timeband        smallint    NOT NULL CHECK (timeband BETWEEN 0 AND 23),
    avg_spd_len     numeric(6, 1),                      -- 도로 길이 가중 (기본)
    avg_spd_simple  numeric(6, 1),                      -- 링크 단순 평균 (민감도 비교)
    link_cnt        int         NOT NULL,
    obs_cnt         int         NOT NULL,
    run_id          text        NOT NULL,
    PRIMARY KEY (base_month, adm_cd, timeband)
);

-- 게시 전 후보 (run 단위, 검증 통과 시 운영 마트로 교체)
CREATE TABLE IF NOT EXISTS mart.candidate_admdong_indicator (LIKE mart.fact_admdong_indicator INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TABLE IF NOT EXISTS mart.candidate_admdong_timeband (LIKE mart.fact_admdong_timeband INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
-- 기존 DB 보강: 충전소 유형 참고
ALTER TABLE mart.fact_admdong_indicator ADD COLUMN IF NOT EXISTS charger_hint text
    CHECK (charger_hint IN ('fast', 'slow', 'mixed'));
ALTER TABLE mart.candidate_admdong_indicator ADD COLUMN IF NOT EXISTS charger_hint text
    CHECK (charger_hint IN ('fast', 'slow', 'mixed'));
CREATE INDEX IF NOT EXISTS candidate_indicator_run_idx ON mart.candidate_admdong_indicator (run_id);
CREATE INDEX IF NOT EXISTS candidate_timeband_run_idx ON mart.candidate_admdong_timeband (run_id);

-- 시간대 차원
CREATE TABLE IF NOT EXISTS mart.dim_timeband (
    timeband        smallint    PRIMARY KEY CHECK (timeband BETWEEN 0 AND 23),
    label           text        NOT NULL,               -- 예: 08-09시
    is_daytime      boolean     NOT NULL                -- 주간 목표 시간대
);

-- 행정동 차원 (활성 경계 버전)
CREATE OR REPLACE VIEW mart.dim_admdong AS
SELECT a.adm_cd, a.adm_nm, a.sgg_cd, a.sgg_nm, a.boundary_ver
FROM core.admdong a
JOIN core.master_version v ON v.master_type = 'boundary' AND v.version = a.boundary_ver AND v.status = 'active';

-- 기준월 차원
CREATE OR REPLACE VIEW mart.dim_base_month AS
SELECT DISTINCT base_month, to_date(base_month, 'YYYYMM') AS month_start
FROM mart.fact_admdong_indicator;

-- 조회용 결과 (Rshiny·SQL 사용자): 게시 상태와 함께 노출
CREATE OR REPLACE VIEW mart.v_admdong_result AS
SELECT f.base_month, d.sgg_nm, d.adm_nm, f.adm_cd,
       f.classification, f.quality_grade, f.reason_codes,
       f.ev_cnt, f.ev_share, f.ev_yoy_rate, f.speed_cv, f.coverage,
       f.traffic_window_start, f.traffic_window_end, f.period_mismatch, f.b_suppressed,
       s.status AS publish_status, s.last_published_at, s.reason AS status_reason,
       f.threshold_ver, f.run_id,
       f.avg_spd, f.low_spd_ratio, f.charger_hint,
       CASE f.charger_hint WHEN 'fast' THEN '도로변 급속 검토' WHEN 'slow' THEN '거점·완속 우선'
                           WHEN 'mixed' THEN '혼합 검토' END AS charger_hint_nm
FROM mart.fact_admdong_indicator f
JOIN mart.dim_admdong d USING (adm_cd)
LEFT JOIN ops.publish_status s USING (base_month);
