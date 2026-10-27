-- core 마스터: 버전 단위 추가 전용 (과거 결과 재현용)

-- 마스터 버전 (등록 → 검증 → 활성)
CREATE TABLE IF NOT EXISTS core.master_version (
    master_type     text        NOT NULL CHECK (master_type IN ('boundary', 'link')),
    version         text        NOT NULL,
    status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'retired')),
    source_ref      text,
    quality         jsonb,                              -- 검증 지표 (조인율, 귀속률 등)
    registered_at   timestamptz NOT NULL DEFAULT now(),
    activated_at    timestamptz,
    PRIMARY KEY (master_type, version)
);
-- 유형별 활성 버전 1개
CREATE UNIQUE INDEX IF NOT EXISTS master_version_active_uq ON core.master_version (master_type) WHERE status = 'active';

-- 행정동 경계
CREATE TABLE IF NOT EXISTS core.admdong (
    boundary_ver    text        NOT NULL,
    adm_cd          char(10)    NOT NULL,               -- 행안부 10자리
    adm_nm          text        NOT NULL,
    sgg_cd          char(5)     NOT NULL,
    sgg_nm          text        NOT NULL,
    geom            geometry(MultiPolygon, 5186) NOT NULL,
    PRIMARY KEY (boundary_ver, adm_cd)
);
CREATE INDEX IF NOT EXISTS admdong_geom_idx ON core.admdong USING gist (geom);

-- 서비스링크 ↔ 표준링크 매핑 (원천에 순번 중복·결측 존재 → 원천 행 번호를 키로)
CREATE TABLE IF NOT EXISTS core.service_link_map (
    mapping_ver     text        NOT NULL,
    row_no          int         NOT NULL,               -- 원천 행 순서
    service_link_id text        NOT NULL,
    std_link_seq    int,                                -- 결측 가능
    std_link_id     text,                               -- 원천 결측 23건
    PRIMARY KEY (mapping_ver, row_no)
);
CREATE INDEX IF NOT EXISTS service_link_map_svc_idx ON core.service_link_map (mapping_ver, service_link_id);

-- 표준링크 형상 (매핑에 쓰인 링크만)
CREATE TABLE IF NOT EXISTS core.std_link (
    shp_ver         text        NOT NULL,
    link_id         text        NOT NULL,
    road_name       text,
    road_rank       text,
    lanes           int,
    max_spd         int,
    geom            geometry(LineString, 5186) NOT NULL,
    PRIMARY KEY (shp_ver, link_id)
);

-- 서비스링크 형상 (표준링크 순서 연결, 틈은 직선 보간)
CREATE TABLE IF NOT EXISTS core.service_link (
    link_ver        text        NOT NULL,               -- 매핑 버전 + SHP 버전
    service_link_id text        NOT NULL,
    std_cnt         int         NOT NULL,
    std_hit         int         NOT NULL,
    length_m        numeric(10, 1) NOT NULL,
    gap_len_m       numeric(10, 1) NOT NULL,            -- 보간 길이 (품질 지표)
    geom            geometry(LineString, 5186) NOT NULL,
    mid             geometry(Point, 5186) NOT NULL,     -- 선의 중점
    PRIMARY KEY (link_ver, service_link_id)
);
CREATE INDEX IF NOT EXISTS service_link_mid_idx ON core.service_link USING gist (mid);

-- 링크 → 행정동 귀속 (형상 없는 링크 포함 전체)
CREATE TABLE IF NOT EXISTS core.link_admdong (
    link_ver        text        NOT NULL,
    boundary_ver    text        NOT NULL,
    service_link_id text        NOT NULL,
    adm_cd          char(10),
    cand_cnt        int         NOT NULL DEFAULT 0,
    assign_status   text        NOT NULL CHECK (assign_status IN ('assigned', 'multi_resolved', 'outside', 'no_geometry')),
    PRIMARY KEY (link_ver, boundary_ver, service_link_id)
);
CREATE INDEX IF NOT EXISTS link_admdong_adm_idx ON core.link_admdong (boundary_ver, adm_cd);

-- 수집 대상 링크 (커버리지 분모, 사전 고정)
CREATE TABLE IF NOT EXISTS core.target_link (
    target_set      text        NOT NULL,               -- 예: mvp_3gu_v1
    service_link_id text        NOT NULL,
    adm_cd          char(10)    NOT NULL,
    link_ver        text        NOT NULL,
    boundary_ver    text        NOT NULL,
    is_excluded     boolean     NOT NULL DEFAULT false, -- 사전 제외 (분모 제외)
    exclude_reason  text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (target_set, service_link_id)
);

-- 연료 코드 (전기차 범위 고정)
CREATE TABLE IF NOT EXISTS core.fuel_code (
    fuel_cd         text        PRIMARY KEY,
    fuel_nm         text        NOT NULL UNIQUE,
    is_ev           boolean     NOT NULL DEFAULT false  -- 판정용 전기차 범위
);
