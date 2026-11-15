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

