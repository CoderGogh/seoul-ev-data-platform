-- 판정 순서: 치명 → WITHHELD, 기준 미달 → C, 규모·추세 모두 기준 이상 → A, 그 외 참고군 (B 는 원천 관측시각 없어 비활성)
-- 파라미터: run_id, threshold_ver
WITH p AS (SELECT params FROM ops.threshold_version WHERE threshold_ver = %(threshold_ver)s)
UPDATE mart.candidate_admdong_indicator c
SET classification = CASE
        WHEN c.quality_grade = 'fatal' THEN 'WITHHELD'
        WHEN c.quality_grade = 'below' THEN 'C'
        WHEN c.ev_cnt >= (p.params->>'a_min_ev_cnt')::int
         AND c.ev_yoy_rate >= (p.params->>'a_min_yoy_rate')::numeric THEN 'A'  -- 증가율 계산 불가(NULL)는 A 제외
        ELSE 'REF' END,
    b_suppressed = true
FROM p
WHERE c.run_id = %(run_id)s
RETURNING c.classification;
