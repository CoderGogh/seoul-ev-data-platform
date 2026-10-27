-- core 사실 데이터: 관측 이력, 시간대 집계, 등록 스냅샷

-- 도로 관측 이력 (멱등 키: 링크 × 수집 회차)
CREATE TABLE IF NOT EXISTS core.traffic_obs (
    link_id             text        NOT NULL,
    poll_batch_id       text        NOT NULL,
    collected_at        timestamptz NOT NULL,
    source_observed_at  timestamptz,                    -- 원천 미제공, 항상 NULL
    prcs_spd            numeric(6, 1) NOT NULL,         -- km/h
    prcs_trv_time       numeric(8, 1) NOT NULL,         -- 초
    run_id              text        NOT NULL,
    PRIMARY KEY (link_id, poll_batch_id)
);
CREATE INDEX IF NOT EXISTS traffic_obs_collected_idx ON core.traffic_obs (collected_at);

-- 링크 × 날짜 × 시간대 대표 관측
CREATE TABLE IF NOT EXISTS core.link_timeband (
    link_id             text        NOT NULL,
    obs_date            date        NOT NULL,           -- KST
    timeband            smallint    NOT NULL CHECK (timeband BETWEEN 0 AND 23),
    rep_spd             numeric(6, 1) NOT NULL,         -- 목표 시각 최근접 유효 관측
    rep_trv_time        numeric(8, 1) NOT NULL,
    rep_collected_at    timestamptz NOT NULL,
    obs_cnt             int         NOT NULL,           -- 시간대 내 유효 관측 수
    is_final            boolean     NOT NULL DEFAULT false, -- 시간대 종료 후 확정
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (link_id, obs_date, timeband)
);
CREATE INDEX IF NOT EXISTS link_timeband_date_idx ON core.link_timeband (obs_date);

-- 등록 스냅샷 (행정동 × 기준월 × 연료, 사용본거지 차이는 합산)
CREATE TABLE IF NOT EXISTS core.reg_snapshot (
    base_month      char(6)     NOT NULL,
    adm_cd          char(10)    NOT NULL,
    fuel_cd         text        NOT NULL REFERENCES core.fuel_code (fuel_cd),
    gov_car int NOT NULL, gov_van int NOT NULL, gov_truck int NOT NULL, gov_special int NOT NULL,  -- 관용
    pvt_car int NOT NULL, pvt_van int NOT NULL, pvt_truck int NOT NULL, pvt_special int NOT NULL,  -- 자가용
    biz_car int NOT NULL, biz_van int NOT NULL, biz_truck int NOT NULL, biz_special int NOT NULL,  -- 영업용
    total_cnt       int         NOT NULL,
    load_id         bigint      NOT NULL,               -- ops.reg_load
    PRIMARY KEY (base_month, adm_cd, fuel_cd),
    CHECK (total_cnt = gov_car + gov_van + gov_truck + gov_special
                     + pvt_car + pvt_van + pvt_truck + pvt_special
                     + biz_car + biz_van + biz_truck + biz_special)
);
