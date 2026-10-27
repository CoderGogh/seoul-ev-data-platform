-- quarantine: 격리 레코드 (나머지 처리 계속, 사유 보존)

-- 도로 관측 격리 (값 검증 실패)
CREATE TABLE IF NOT EXISTS quarantine.traffic_record (
    poll_batch_id   text        NOT NULL,
    link_id         text        NOT NULL,
    run_id          text        NOT NULL,
    reason_code     text        NOT NULL,               -- 예: spd_out_of_range, non_numeric
    raw             jsonb       NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (poll_batch_id, link_id)
);

-- 등록 레코드 격리 (코드 매핑 실패 등)
CREATE TABLE IF NOT EXISTS quarantine.registration_record (
    run_id          text        NOT NULL,
    row_no          int         NOT NULL,
    base_month      char(6)     NOT NULL,
    reason_code     text        NOT NULL,               -- etc_dong / legacy_dong / name_unmatched / unknown_fuel
    raw             jsonb       NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, row_no)
);
CREATE INDEX IF NOT EXISTS registration_record_month_idx ON quarantine.registration_record (base_month, reason_code);
