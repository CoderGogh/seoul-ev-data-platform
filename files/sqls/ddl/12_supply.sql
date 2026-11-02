-- 충전기 공급 지표 (ev03 ← core.charger) + 분류 임계값 mvp_v3

-- 마트 공급 컬럼 (운영·후보 같은 순서: 게시가 SELECT * 로 복사)
ALTER TABLE mart.fact_admdong_indicator ADD COLUMN IF NOT EXISTS charger_asof date;          -- 공급 기준일
ALTER TABLE mart.fact_admdong_indicator ADD COLUMN IF NOT EXISTS charger_cnt int;            -- 승용 충전기 (버스전용 제외)
ALTER TABLE mart.fact_admdong_indicator ADD COLUMN IF NOT EXISTS fast_cnt int;               -- 급속 (50kW 이상)
ALTER TABLE mart.fact_admdong_indicator ADD COLUMN IF NOT EXISTS open_cnt int;               -- 이용 제한 없음
ALTER TABLE mart.fact_admdong_indicator ADD COLUMN IF NOT EXISTS ev_per_charger numeric(8, 2); -- 충전기 1대당 전기차
ALTER TABLE mart.fact_admdong_indicator ADD COLUMN IF NOT EXISTS supply_gap boolean;         -- 공급 부족 (임계값 이상)
ALTER TABLE mart.candidate_admdong_indicator ADD COLUMN IF NOT EXISTS charger_asof date;
ALTER TABLE mart.candidate_admdong_indicator ADD COLUMN IF NOT EXISTS charger_cnt int;
ALTER TABLE mart.candidate_admdong_indicator ADD COLUMN IF NOT EXISTS fast_cnt int;
ALTER TABLE mart.candidate_admdong_indicator ADD COLUMN IF NOT EXISTS open_cnt int;
ALTER TABLE mart.candidate_admdong_indicator ADD COLUMN IF NOT EXISTS ev_per_charger numeric(8, 2);
ALTER TABLE mart.candidate_admdong_indicator ADD COLUMN IF NOT EXISTS supply_gap boolean;

-- mvp_v3: v2 + 공급 부족 조건 (A = 수요 기준 통과 + 충전기 1대당 전기차 기준 이상)
-- 근거: 67개 행정동 충전기 1대당 전기차 중앙값 2.08 (3개 구 전체 2.17), 2026-11-02 첫 스냅샷. 이용 제한 충전기 포함
--       (등록은 거주지 기준이라 아파트 충전기도 그 동 전기차의 공급)
INSERT INTO ops.threshold_version (threshold_ver, params, basis, note, is_active)
SELECT 'mvp_v3', params || jsonb_build_object(
            'a_min_ev_per_charger', 2.1),  -- 공급 부족: 충전기 1대당 전기차 (p50)
       'provisional', 'v2 + 공급 부족(충전기 1대당 전기차 p50). 공급 기준일은 기준월 말일, 이력 시작 전이면 첫 스냅샷', false
FROM ops.threshold_version WHERE threshold_ver = 'mvp_v2'
ON CONFLICT (threshold_ver) DO NOTHING;

-- 활성 버전 전환 (부분 유니크 인덱스: 해제 후 지정)
UPDATE ops.threshold_version SET is_active = false WHERE is_active AND threshold_ver <> 'mvp_v3';
UPDATE ops.threshold_version SET is_active = true WHERE threshold_ver = 'mvp_v3';
