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

-- mvp_v2: 도로 여건 기준 추가 (A 판정 기준은 v1 과 동일)
-- 근거: 67개 행정동 저속 관측 비중(15km/h 미만) p33 = 13.4%, p67 = 22.2%
INSERT INTO ops.threshold_version (threshold_ver, params, basis, note, is_active)
SELECT 'mvp_v2', params || jsonb_build_object(
            'hint_fast_max_low', 13,      -- 저속 비중 % 미만 → 원활
            'hint_slow_min_low', 22),     -- 저속 비중 % 이상 → 혼잡
       'provisional', 'v1 + 도로 여건(저속 비중 p33·p67). 수요 지표 아님, 현장 조사 전 참고', false
FROM ops.threshold_version WHERE threshold_ver = 'mvp_v1'
ON CONFLICT (threshold_ver) DO NOTHING;

-- 활성 버전 전환 (부분 유니크 인덱스: 해제 후 지정)
UPDATE ops.threshold_version SET is_active = false WHERE is_active AND threshold_ver <> 'mvp_v2';
UPDATE ops.threshold_version SET is_active = true WHERE threshold_ver = 'mvp_v2';
