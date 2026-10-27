-- staging: 원천 그대로 + 실행 식별자 (재처리·추적 근거)

-- 도로소통 원천 응답 (링크 1건 = 호출 1회)
CREATE TABLE IF NOT EXISTS staging.traffic_raw (
    poll_batch_id   text        NOT NULL,               -- 논리적 수집 회차 (run_id 파생)
    link_id         text        NOT NULL,               -- 서비스링크 ID
    run_id          text        NOT NULL,
    chunk_no        int         NOT NULL,
    collected_at    timestamptz NOT NULL,               -- 수집 시각 (원천 관측시각 없음)
    result_code     text,                               -- INFO-000 / INFO-200 / ERROR-xxx
    call_status     text        NOT NULL CHECK (call_status IN ('ok', 'no_data', 'api_error')),
    prcs_spd        text,                               -- 원문 값 (검증 전)
    prcs_trv_time   text,
    resp_ms         int,
    PRIMARY KEY (poll_batch_id, link_id)
);
CREATE INDEX IF NOT EXISTS traffic_raw_run_idx ON staging.traffic_raw (run_id);

-- 등록현황 원천 (API·파일 공통, 값은 문자열 그대로)
CREATE TABLE IF NOT EXISTS staging.registration_raw (
    run_id          text        NOT NULL,
    row_no          int         NOT NULL,               -- 원천 행 번호
    source          text        NOT NULL CHECK (source IN ('api', 'file')),
    source_ref      text,                               -- 파일명 또는 API 서비스명
    base_month      char(6)     NOT NULL,               -- 대상 기준월 (YYYYMM)
    stats_ym        text,
    sgg_cd          text,                               -- 파일 원천은 코드 없음
    dong_cd         text,
    fuel_cd         text,
    sgg_nm          text,                               -- 사용본거지 시군구
    adstrd_nm       text,
    fuel_nm         text,
    sum11 text, sum12 text, sum13 text, sum14 text,     -- 관용 승용·승합·화물·특수
    sum21 text, sum22 text, sum23 text, sum24 text,     -- 자가용
    sum31 text, sum32 text, sum33 text, sum34 text,     -- 영업용
    sum_tot         text,
    loaded_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, row_no)
);
CREATE INDEX IF NOT EXISTS registration_raw_month_idx ON staging.registration_raw (base_month);

-- 표준노드링크 SHP 원본 (전국, 마스터 빌드 후 삭제 가능)
-- shp2pgsql 이 생성하므로 DDL 없음: staging.moct_link_raw
