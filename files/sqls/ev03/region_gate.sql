-- Gate 2: 지역별 품질 등급 (치명 → WITHHELD, 기준 미달 → C, 경고 → 지표 제한)
-- 파라미터: run_id, threshold_ver
WITH p AS (SELECT params FROM ops.threshold_version WHERE threshold_ver = %(threshold_ver)s)
UPDATE mart.candidate_admdong_indicator c
SET reason_codes = array_remove(ARRAY[
        CASE WHEN c.ev_cnt IS NULL THEN 'no_registration' END,
        CASE WHEN c.link_cnt = 0 THEN 'no_links' END,
        CASE WHEN c.link_cnt BETWEEN 1 AND (p.params->>'min_link_cnt')::int - 1 THEN 'few_links' END,
        CASE WHEN c.coverage < (p.params->>'min_coverage')::numeric THEN 'low_coverage' END,
        CASE WHEN c.valid_timebands < (p.params->>'min_valid_timebands')::int THEN 'few_timebands' END,
        CASE WHEN c.prev_ev_cnt IS NULL THEN 'no_prev_year' END,
        'period_mismatch', 'b_suppressed_no_source_time'], NULL),
    quality_grade = CASE
        WHEN c.ev_cnt IS NULL OR c.link_cnt = 0 THEN 'fatal'
        WHEN c.link_cnt < (p.params->>'min_link_cnt')::int
          OR c.coverage < (p.params->>'min_coverage')::numeric
          OR c.valid_timebands < (p.params->>'min_valid_timebands')::int THEN 'below'
        WHEN c.prev_ev_cnt IS NULL THEN 'warn'
        ELSE 'ok' END
FROM p
WHERE c.run_id = %(run_id)s
RETURNING c.adm_cd, c.quality_grade;
