-- 게시 이력별 우선 검토(A) 목록 (웹 게시 이력·A 변화). 게시 시 후보에서 기록
ALTER TABLE ops.publish_log ADD COLUMN IF NOT EXISTS a_list char(10)[];   -- A 동 코드
ALTER TABLE ops.publish_log ADD COLUMN IF NOT EXISTS class_dist jsonb;    -- 분류별 동 수

-- 기존 이력 보강: 기준월별 현재 게시 실행만 (이전 실행은 파티션 교체로 복원 불가)
UPDATE ops.publish_log l
SET a_list = coalesce((SELECT array_agg(f.adm_cd ORDER BY f.adm_cd) FROM mart.fact_admdong_indicator f
                       WHERE f.base_month = l.base_month AND f.run_id = l.run_id AND f.classification = 'A'), '{}'),
    class_dist = (SELECT jsonb_object_agg(classification, n) FROM (
                      SELECT classification, count(*) AS n FROM mart.fact_admdong_indicator f
                      WHERE f.base_month = l.base_month AND f.run_id = l.run_id GROUP BY 1) d)
WHERE l.a_list IS NULL
  AND EXISTS (SELECT 1 FROM mart.fact_admdong_indicator f WHERE f.base_month = l.base_month AND f.run_id = l.run_id);
