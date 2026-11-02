-- 충전기 공급 (ev04): 원천 → 검사 → 정제·동 귀속 → 이력(SCD2)

-- 충전기 정보 원천 (응답 item 1건 = 1행, 필드는 원문 그대로)
CREATE TABLE IF NOT EXISTS staging.charger_raw (
    run_id          text        NOT NULL,
    sgg_cd          char(5)     NOT NULL,               -- 요청 zscode
    row_no          int         NOT NULL,               -- 응답 순서
    payload         jsonb       NOT NULL,
    collected_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, sgg_cd, row_no)
);

-- 충전기 타입 코드 (출력값 없을 때 급속 판정 보조)
CREATE TABLE IF NOT EXISTS core.charger_type (
    chger_type      text        PRIMARY KEY,
    type_nm         text        NOT NULL,
    is_fast         boolean     NOT NULL
);
INSERT INTO core.charger_type (chger_type, type_nm, is_fast) VALUES
    ('01', 'DC차데모', true),
    ('02', 'AC완속', false),
    ('03', 'DC차데모+AC3상', true),
    ('04', 'DC콤보', true),
    ('05', 'DC차데모+DC콤보', true),
    ('06', 'DC차데모+AC3상+DC콤보', true),
    ('07', 'AC3상', true),
    ('08', 'DC콤보(완속)', false),
    ('09', 'NACS', true),
    ('10', 'DC콤보+NACS', true)
ON CONFLICT (chger_type) DO UPDATE SET type_nm = EXCLUDED.type_nm, is_fast = EXCLUDED.is_fast;

-- 원천 행 검사 (격리 사유, 삭제 표시). 검사 규칙은 이 view 한 곳에만
CREATE OR REPLACE VIEW staging.v_charger_check AS
WITH r AS (
    SELECT run_id, sgg_cd, row_no, payload,
           nullif(btrim(payload->>'statId'), '') AS stat_id,
           nullif(btrim(payload->>'chgerId'), '') AS chger_id,
           btrim(payload->>'lat') AS lat, btrim(payload->>'lng') AS lng,
           row_number() OVER (PARTITION BY run_id, payload->>'statId', payload->>'chgerId'
                              ORDER BY sgg_cd, row_no) AS dup_no
    FROM staging.charger_raw
)
SELECT run_id, sgg_cd, row_no, payload, stat_id, chger_id,
       CASE WHEN lat ~ '^-?[0-9]+(\.[0-9]+)?$' THEN lat::numeric END AS lat,
       CASE WHEN lng ~ '^-?[0-9]+(\.[0-9]+)?$' THEN lng::numeric END AS lng,
       coalesce(upper(payload->>'delYn'), 'N') = 'Y' AS is_deleted,
       CASE WHEN stat_id IS NULL OR chger_id IS NULL THEN 'missing_key'
            WHEN dup_no > 1 THEN 'duplicate_key'
            WHEN lat !~ '^-?[0-9]+(\.[0-9]+)?$' OR lng !~ '^-?[0-9]+(\.[0-9]+)?$'
              OR lat IS NULL OR lng IS NULL THEN 'invalid_coord'
            WHEN lat::numeric NOT BETWEEN 33 AND 39 OR lng::numeric NOT BETWEEN 124 AND 132 THEN 'invalid_coord'
       END AS reason_code
FROM r;

-- 정제·동 귀속 결과 (실행 단위)
CREATE TABLE IF NOT EXISTS staging.charger_norm (
    run_id          text        NOT NULL,
    stat_id         text        NOT NULL,               -- 충전소 ID
    chger_id        text        NOT NULL,               -- 충전소 내 충전기 ID
    sgg_cd          char(5)     NOT NULL,
    stat_nm         text,
    chger_type      text,
    is_fast         boolean,                            -- 출력 50kW 이상, 출력 없으면 타입 코드
    output_kw       numeric,
    busi_id         text,
    busi_nm         text,
    kind            text,                               -- 설치 장소 대분류
    kind_detail     text,
    limit_yn        text,                               -- 이용자 제한
    parking_free    text,
    addr            text,
    geom            geometry(Point, 5186) NOT NULL,
    boundary_ver    text        NOT NULL,
    adm_cd          char(10),
    assign_status   text        NOT NULL CHECK (assign_status IN ('assigned', 'outside', 'sgg_mismatch')),  -- 불일치: 원천 좌표 오류
    attr_hash       text        NOT NULL,               -- 속성 변경 판정 (상태값 제외)
    PRIMARY KEY (run_id, stat_id, chger_id)
);

-- 충전기 이력 (SCD2): 하루 1회 상태, valid_to NULL = 현재
CREATE TABLE IF NOT EXISTS core.charger (
    stat_id         text        NOT NULL,
    chger_id        text        NOT NULL,
    valid_from      date        NOT NULL,
    valid_to        date,                               -- 이 날짜부터 무효 (미포함)
    sgg_cd          char(5)     NOT NULL,
    stat_nm         text,
    chger_type      text,
    is_fast         boolean,
    output_kw       numeric,
    busi_id         text,
    busi_nm         text,
    kind            text,
    kind_detail     text,
    limit_yn        text,
    parking_free    text,
    addr            text,
    geom            geometry(Point, 5186) NOT NULL,
    boundary_ver    text        NOT NULL,
    adm_cd          char(10),
    assign_status   text        NOT NULL,
    attr_hash       text        NOT NULL,
    load_id         bigint      NOT NULL,
    PRIMARY KEY (stat_id, chger_id, valid_from),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS charger_current_uq ON core.charger (stat_id, chger_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS charger_adm_idx ON core.charger (adm_cd, valid_from);

-- 적재 이력 (변경 건수 근거)
CREATE TABLE IF NOT EXISTS ops.charger_load (
    load_id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    snapshot_date   date        NOT NULL,               -- 수집일 (KST)
    run_id          text        NOT NULL,
    sgg_cds         text[]      NOT NULL,
    row_cnt         int         NOT NULL,
    new_cnt         int         NOT NULL,
    changed_cnt     int         NOT NULL,
    closed_cnt      int         NOT NULL,
    quality_grade   text        NOT NULL CHECK (quality_grade IN ('ok', 'warn', 'fatal')),
    loaded_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS charger_load_date_idx ON ops.charger_load (snapshot_date DESC);

-- 충전기 격리 (키 누락·중복·좌표 오류)
CREATE TABLE IF NOT EXISTS quarantine.charger_record (
    run_id          text        NOT NULL,
    sgg_cd          char(5)     NOT NULL,
    row_no          int         NOT NULL,
    reason_code     text        NOT NULL,               -- missing_key / duplicate_key / invalid_coord
    raw             jsonb       NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, sgg_cd, row_no)
);
