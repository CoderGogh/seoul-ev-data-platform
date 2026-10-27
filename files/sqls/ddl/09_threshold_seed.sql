-- 분류 임계값 초기 버전 (provisional: 분포 확인 후 결정, 민감도 검토 전)
-- 근거: mvp_3gu_v1 대상 67개 행정동, 2026-09 전기차 대수 p60 = 522, 전년 동월 대비 증가율 p60 = 39.7%
INSERT INTO ops.threshold_version (threshold_ver, params, basis, note, is_active)
VALUES ('mvp_v1', jsonb_build_object(
            'a_min_ev_cnt', 522,          -- 유형 A: 전기차 규모 (p60)
            'a_min_yoy_rate', 39.7,       -- 유형 A: 증가율 % (p60)
            'min_coverage', 60,           -- 링크-시간 커버리지 % 미만 → C
            'min_valid_timebands', 6,     -- 주간 유효 시간대 수 미만 → C
            'min_link_cnt', 3,            -- 귀속 링크 수 미만 → C
            'valid_tb_link_ratio', 0.5,   -- 시간대 유효: 관측 링크 비율
            'low_spd_kmh', 15),           -- 저속 관측 기준 (보조 지표)
        'provisional', '대상 67개 행정동 분위수(p60) 기반. 제출 전 민감도 검토 필요', true)
ON CONFLICT (threshold_ver) DO NOTHING;
