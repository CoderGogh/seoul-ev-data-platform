-- 판정 순서: 치명 → WITHHELD, 기준 미달 → C, 규모·추세 모두 기준 이상 → A, 그 외 참고군 (B 는 원천 관측시각 없어 비활성)
-- 충전소 유형 참고: 품질 통과 동만, 도로 저속 비중으로 급속·완속·혼합 (수요 지표 아님)
-- 파라미터: run_id, threshold_ver
WITH p AS (SELECT params FROM ops.threshold_version WHERE threshold_ver = %(threshold_ver)s)
UPDATE mart.candidate_admdong_indicator c
SET classification = CASE
        WHEN c.quality_grade = 'fatal' THEN 'WITHHELD'
        WHEN c.quality_grade = 'below' THEN 'C'
        WHEN c.ev_cnt >= (p.params->>'a_min_ev_cnt')::int
         AND c.ev_yoy_rate >= (p.params->>'a_min_yoy_rate')::numeric THEN 'A'  -- 증가율 계산 불가(NULL)는 A 제외
        ELSE 'REF' END,
    charger_hint = CASE
        WHEN c.quality_grade IN ('fatal', 'below') OR c.low_spd_ratio IS NULL
          OR p.params->>'hint_fast_max_low' IS NULL THEN NULL  -- 기준 없는 버전은 미산출
        WHEN c.low_spd_ratio < (p.params->>'hint_fast_max_low')::numeric THEN 'fast'
        WHEN c.low_spd_ratio >= (p.params->>'hint_slow_min_low')::numeric THEN 'slow'
        ELSE 'mixed' END,
    b_suppressed = true
FROM p
WHERE c.run_id = %(run_id)s
RETURNING c.classification, c.charger_hint;
