-- 수요 보조 (ev05): 공동주택 세대수·공영주차장 → 행정동 귀속 → 주간 스냅샷 → 마트 참고 지표
-- 좌표: 지오코더 결과 저장 금지(브이월드 약관) → 실행 중 행정동 판정에만 사용, 행정동 코드만 보관

-- 공동주택 원천 (단지 목록 item + 기본 정보 item, 필드는 원문 그대로)
CREATE TABLE IF NOT EXISTS staging.apt_raw (
    run_id          text        NOT NULL,
    sgg_cd          char(5)     NOT NULL,               -- 요청 sigunguCode
    row_no          int         NOT NULL,               -- 목록 응답 순서
    list_payload    jsonb       NOT NULL,
    basis_payload   jsonb,                              -- 기본 정보 (조회 실패 시 NULL → 격리)
    collected_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, sgg_cd, row_no)
);

-- 공영주차장 원천 (서울 전체 응답 행, 노상은 구획마다 1행)
CREATE TABLE IF NOT EXISTS staging.parking_raw (
    run_id          text        NOT NULL,
    row_no          int         NOT NULL,
    payload         jsonb       NOT NULL,
    collected_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, row_no)
);

-- 공동주택 행 검사 (격리 사유). 검사 규칙은 이 view 한 곳에만
CREATE OR REPLACE VIEW staging.v_apt_check AS
WITH r AS (
    SELECT run_id, sgg_cd, row_no, list_payload, basis_payload,
           nullif(btrim(list_payload->>'kaptCode'), '') AS kapt_code,
           btrim(basis_payload->>'kaptdaCnt') AS hh,
           row_number() OVER (PARTITION BY run_id, list_payload->>'kaptCode' ORDER BY sgg_cd, row_no) AS dup_no
    FROM staging.apt_raw
)
SELECT run_id, sgg_cd, row_no, list_payload, basis_payload, kapt_code,
       CASE WHEN hh ~ '^[0-9]+(\.0+)?$' THEN hh::numeric::int END AS hh_cnt,
       CASE WHEN kapt_code IS NULL THEN 'missing_key'
            WHEN dup_no > 1 THEN 'duplicate_key'
            WHEN basis_payload IS NULL THEN 'missing_basis'
            WHEN hh IS NULL OR hh !~ '^[0-9]+(\.0+)?$' OR hh::numeric <= 0 THEN 'invalid_hh'
       END AS reason_code
FROM r;

-- 공영주차장 행 검사 (주차장 코드·주차면). 대상 구 판정용 구 이름 포함
CREATE OR REPLACE VIEW staging.v_parking_check AS
WITH r AS (
    SELECT run_id, row_no, payload,
           nullif(btrim(payload->>'PKLT_CD'), '') AS pklt_cd,
           regexp_replace(btrim(payload->>'ADDR'), '^서울(특별)?시\s+', '') AS addr,
           btrim(payload->>'TPKCT') AS tpkct,
           btrim(payload->>'LAT') AS lat, btrim(payload->>'LOT') AS lng
    FROM staging.parking_raw
)
SELECT run_id, row_no, payload, pklt_cd, addr, split_part(addr, ' ', 1) AS sgg_nm,
       CASE WHEN tpkct ~ '^[0-9]+(\.[0-9]+)?$' THEN tpkct::numeric END AS space_cnt,
       CASE WHEN lat ~ '^[0-9]+(\.[0-9]+)?$' AND lng ~ '^[0-9]+(\.[0-9]+)?$'
             AND lat::numeric BETWEEN 33 AND 39 AND lng::numeric BETWEEN 124 AND 132
            THEN lat::numeric END AS lat,  -- 원천 좌표 0.0 다수 → 범위 밖은 없음 취급
       CASE WHEN lat ~ '^[0-9]+(\.[0-9]+)?$' AND lng ~ '^[0-9]+(\.[0-9]+)?$'
             AND lat::numeric BETWEEN 33 AND 39 AND lng::numeric BETWEEN 124 AND 132
            THEN lng::numeric END AS lng,
       CASE WHEN pklt_cd IS NULL THEN 'missing_key'
            WHEN tpkct IS NULL OR tpkct !~ '^[0-9]+(\.[0-9]+)?$' THEN 'invalid_space'
       END AS reason_code
FROM r;

-- 위치 판정 결과 (실행 단위, 행정동 코드만. 좌표 미보관)
CREATE TABLE IF NOT EXISTS staging.aux_locate (
    run_id          text        NOT NULL,
    src             text        NOT NULL CHECK (src IN ('apt', 'parking')),
    src_key         text        NOT NULL,               -- kaptCode / PKLT_CD
    adm_cd          char(10),
    loc_source      text        NOT NULL CHECK (loc_source IN ('source_coord', 'geocoded_road', 'geocoded_parcel', 'none')),
    PRIMARY KEY (run_id, src, src_key)
);

-- 공동주택 정제·동 귀속 (실행 단위)
CREATE TABLE IF NOT EXISTS staging.apt_norm (
    run_id          text        NOT NULL,
    kapt_code       text        NOT NULL,
    sgg_cd          char(5)     NOT NULL,
    kapt_name       text,
    bjd_code        char(10),                           -- 법정동 (참고)
    hh_cnt          int         NOT NULL,               -- 세대수
    dong_cnt        int,
    apt_type        text,                               -- 아파트 / 주상복합 등
    use_date        date,                               -- 사용승인일
    doro_juso       text,
    boundary_ver    text        NOT NULL,
    adm_cd          char(10),
    loc_source      text        NOT NULL,
    assign_status   text        NOT NULL CHECK (assign_status IN ('assigned', 'outside', 'sgg_mismatch', 'unlocated')),
    PRIMARY KEY (run_id, kapt_code)
);

-- 공영주차장 정제·동 귀속 (실행 단위, 주차장 코드당 1행: 노상 구획 행 합산)
CREATE TABLE IF NOT EXISTS staging.parking_norm (
    run_id          text        NOT NULL,
    pklt_cd         text        NOT NULL,
    sgg_cd          char(5)     NOT NULL,
    pklt_nm         text,
    addr            text,
    kind_nm         text,                               -- 노상 / 노외
    oper_nm         text,                               -- 시간제 / 거주자 우선
    pay_nm          text,
    space_cnt       int         NOT NULL,               -- 주차면 (구획 행 합)
    slot_rows       int         NOT NULL,               -- 원천 행 수
    boundary_ver    text        NOT NULL,
    adm_cd          char(10),
    loc_source      text        NOT NULL,
    assign_status   text        NOT NULL CHECK (assign_status IN ('assigned', 'outside', 'sgg_mismatch', 'unlocated')),
    PRIMARY KEY (run_id, pklt_cd)
);

