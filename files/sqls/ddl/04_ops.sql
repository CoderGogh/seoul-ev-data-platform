-- ops: 실행 상태·품질·계보 (Airflow 실행 상태와 별개인 데이터 상태)

-- DAG 실행 결과 (run_id 키 UPSERT)
CREATE TABLE IF NOT EXISTS ops.pipeline_run (
    dag_id          text        NOT NULL,
    run_id          text        NOT NULL,
    logical_date    timestamptz,
    partition_key   text,                               -- poll_batch_id 또는 base_month
    status          text        NOT NULL CHECK (status IN (
                        'running', 'success', 'partial', 'skipped_stale', 'unchanged', 'republished',
                        'publication_delayed', 'no_eligible_period', 'skipped_unchanged', 'held',
                        'published', 'failed', 'reprocessed')),
    status_reason   text,
    trigger_type    text,                               -- cron / asset / manual / reprocess
    request_id      bigint,                             -- ops.reprocess_request
    detail          jsonb,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    PRIMARY KEY (dag_id, run_id)
);
CREATE INDEX IF NOT EXISTS pipeline_run_status_idx ON ops.pipeline_run (dag_id, status, started_at DESC);

-- ev01 묶음 계획·완료 (XCom 대신 검증 근거)
CREATE TABLE IF NOT EXISTS ops.poll_chunk (
    poll_batch_id   text        NOT NULL,
    chunk_no        int         NOT NULL,
    link_cnt        int         NOT NULL,
    status          text        NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done')),
    done_at         timestamptz,
    PRIMARY KEY (poll_batch_id, chunk_no)
);

-- ev01 회차별 커버리지 (분모 = 대상 링크)
CREATE TABLE IF NOT EXISTS ops.poll_coverage (
    poll_batch_id   text        PRIMARY KEY,
    run_id          text        NOT NULL,
    target_set      text        NOT NULL,
    target_cnt      int         NOT NULL,
    ok_cnt          int         NOT NULL,
    no_data_cnt     int         NOT NULL,               -- 정상 응답 내 무관측
    api_error_cnt   int         NOT NULL,               -- 분모 포함, 분자 제외
    invalid_cnt     int         NOT NULL,               -- 값 검증 실패 (격리)
    excluded_cnt    int         NOT NULL,               -- 사전 제외
    planned_chunks  int         NOT NULL,
    done_chunks     int         NOT NULL,
    collected_at    timestamptz NOT NULL
);

-- 등록 적재 이력 (재공표 비교 근거)
CREATE TABLE IF NOT EXISTS ops.reg_load (
    load_id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    base_month      char(6)     NOT NULL,
    source          text        NOT NULL CHECK (source IN ('api', 'file')),
    source_ref      text,
    run_id          text        NOT NULL,
    row_cnt         int         NOT NULL,
    content_hash    text        NOT NULL,               -- 정제 결과 해시 (동일 내용 판정)
    prev_load_id    bigint      REFERENCES ops.reg_load (load_id),
    diff            jsonb,                              -- 재공표 차이 (행 수·합계·변경 행정동)
    quality_grade   text        NOT NULL CHECK (quality_grade IN ('ok', 'warn', 'fatal')),
    loaded_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reg_load_month_idx ON ops.reg_load (base_month, loaded_at DESC);

-- 품질 검사 결과 (실행 단위·지역 단위 공통)
CREATE TABLE IF NOT EXISTS ops.quality_result (
    dag_id          text        NOT NULL,
    run_id          text        NOT NULL,
    check_name      text        NOT NULL,               -- 예: coverage, mapping_rate, unknown_adm_cd
    scope_key       text        NOT NULL DEFAULT '*',   -- '*' = 실행 전체, 그 외 adm_cd 등
    grade           text        NOT NULL CHECK (grade IN ('ok', 'warn', 'below', 'fatal')),
    metric          numeric,
    threshold       numeric,
    detail          jsonb,
    checked_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dag_id, run_id, check_name, scope_key)
);

-- 분류 임계값 버전 (계보 연결)
CREATE TABLE IF NOT EXISTS ops.threshold_version (
    threshold_ver   text        PRIMARY KEY,
    params          jsonb       NOT NULL,               -- 규모·증가율·커버리지 기준 등
    basis           text        NOT NULL CHECK (basis IN ('provisional', 'data_confirmed')),  -- 분포 확인 전 / 데이터로 확정
    note            text,
    is_active       boolean     NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS threshold_version_active_uq ON ops.threshold_version ((true)) WHERE is_active;

-- ev03 평가 이력 (dirty 월 판정: 게시·보류 모두 기록)
CREATE TABLE IF NOT EXISTS ops.mart_eval (
    base_month      char(6)     NOT NULL,
    run_id          text        NOT NULL,
    fingerprint     text        NOT NULL,
    eval_status     text        NOT NULL CHECK (eval_status IN ('published', 'held')),
    evaluated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (base_month, run_id)
);
CREATE INDEX IF NOT EXISTS mart_eval_latest_idx ON ops.mart_eval (base_month, evaluated_at DESC);

-- 게시 로그 (게시 트랜잭션 안에서 기록, 계보 원천)
CREATE TABLE IF NOT EXISTS ops.publish_log (
    base_month           char(6)     NOT NULL,
    run_id               text        NOT NULL,
    fingerprint          text        NOT NULL,
    reg_load_id          bigint      NOT NULL REFERENCES ops.reg_load (load_id),
    prev_reg_load_id     bigint      REFERENCES ops.reg_load (load_id),  -- 전년 동월
    link_ver             text        NOT NULL,
    boundary_ver         text        NOT NULL,
    threshold_ver        text        NOT NULL REFERENCES ops.threshold_version (threshold_ver),
    target_set           text        NOT NULL,
    traffic_window_start timestamptz NOT NULL,
    traffic_window_end   timestamptz NOT NULL,
    period_mismatch      boolean     NOT NULL,          -- MVP 분석 기간 예외 여부
    region_cnt           int         NOT NULL,
    request_id           bigint,
    published_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (base_month, run_id)
);

-- 게시 상태 (기준월 단위, 사용자 노출)
CREATE TABLE IF NOT EXISTS ops.publish_status (
    base_month          char(6)     PRIMARY KEY,
    status              text        NOT NULL CHECK (status IN ('current', 'stale', 'never_published')),
    last_published_run  text,
    last_published_at   timestamptz,
    reason              text,
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 재처리 요청 (ev11 진입점)
CREATE TABLE IF NOT EXISTS ops.reprocess_request (
    request_id      bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scope           text        NOT NULL CHECK (scope IN ('registration', 'timeband', 'mart')),
    base_months     char(6)[],
    date_from       date,
    date_to         date,
    force           boolean     NOT NULL DEFAULT false,
    reason          text        NOT NULL,
    status          text        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'running', 'done', 'failed')),
    requested_by    text,
    requested_at    timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    detail          jsonb
);

-- 등록 스냅샷 → 적재 이력 참조 (생성 순서상 여기서 추가)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reg_snapshot_load_fk') THEN
        ALTER TABLE core.reg_snapshot ADD CONSTRAINT reg_snapshot_load_fk FOREIGN KEY (load_id) REFERENCES ops.reg_load (load_id);
    END IF;
END $$;
