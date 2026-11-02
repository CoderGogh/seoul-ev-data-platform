-- 판정 순서: 치명 → WITHHELD, 기준 미달 → C, 규모·추세 기준 이상(v3: + 공급 부족) → A, 그 외 참고군 (B 는 원천 관측시각 없어 비활성)
-- 도로 여건: 품질 통과 동만, 저속 비중으로 원활·보통·혼잡 (수요 지표 아님, 유형 결정은 현장 조사)
-- 파라미터: run_id, threshold_ver

-- 공급 부족: 충전기 없음 또는 1대당 전기차 기준 이상. 기준 없는 버전·공급 미산출은 NULL
WITH p AS (SELECT params FROM ops.threshold_version WHERE threshold_ver = %(threshold_ver)s)
UPDATE mart.candidate_admdong_indicator c
SET supply_gap = CASE
        WHEN p.params->>'a_min_ev_per_charger' IS NULL OR c.charger_cnt IS NULL THEN NULL
        WHEN c.charger_cnt = 0 THEN c.ev_cnt > 0
        ELSE c.ev_per_charger >= (p.params->>'a_min_ev_per_charger')::numeric END
FROM p
WHERE c.run_id = %(run_id)s;

WITH p AS (SELECT params FROM ops.threshold_version WHERE threshold_ver = %(threshold_ver)s)
UPDATE mart.candidate_admdong_indicator c
SET classification = CASE
        WHEN c.quality_grade = 'fatal' THEN 'WITHHELD'
        WHEN c.quality_grade = 'below' THEN 'C'
        WHEN d.demand AND (p.params->>'a_min_ev_per_charger' IS NULL OR c.supply_gap) THEN 'A'
        ELSE 'REF' END,
    reason_codes = c.reason_codes || CASE  -- 수요 기준 통과, 공급 충분 → 관찰 대상
        WHEN c.quality_grade NOT IN ('fatal', 'below') AND d.demand
         AND p.params->>'a_min_ev_per_charger' IS NOT NULL AND NOT coalesce(c.supply_gap, true)
        THEN ARRAY['supply_sufficient'] ELSE ARRAY[]::text[] END,
    charger_hint = CASE
        WHEN c.quality_grade IN ('fatal', 'below') OR c.low_spd_ratio IS NULL
          OR p.params->>'hint_fast_max_low' IS NULL THEN NULL  -- 기준 없는 버전은 미산출
        WHEN c.low_spd_ratio < (p.params->>'hint_fast_max_low')::numeric THEN 'fast'
        WHEN c.low_spd_ratio >= (p.params->>'hint_slow_min_low')::numeric THEN 'slow'
        ELSE 'mixed' END,
    b_suppressed = true
FROM p, mart.candidate_admdong_indicator d0
CROSS JOIN LATERAL (  -- 수요 기준: 규모·증가율 (증가율 계산 불가는 미통과)
    SELECT coalesce(d0.ev_cnt >= (SELECT (params->>'a_min_ev_cnt')::int FROM ops.threshold_version
                                  WHERE threshold_ver = %(threshold_ver)s)
                    AND d0.ev_yoy_rate >= (SELECT (params->>'a_min_yoy_rate')::numeric FROM ops.threshold_version
                                           WHERE threshold_ver = %(threshold_ver)s), false) AS demand
) d
WHERE c.run_id = %(run_id)s AND d0.run_id = c.run_id AND d0.adm_cd = c.adm_cd
RETURNING c.classification, c.charger_hint;
