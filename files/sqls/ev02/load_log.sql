-- 적재 이력 기록 (재공표 차이 포함). 스냅샷 교체와 같은 트랜잭션에서 실행
WITH prev AS (
    SELECT load_id FROM ops.reg_load WHERE base_month = %(base_month)s ORDER BY loaded_at DESC LIMIT 1
), diff AS (
    SELECT jsonb_build_object(
        'row_cnt_prev', (SELECT count(*) FROM core.reg_snapshot WHERE base_month = %(base_month)s),
        'total_prev', (SELECT coalesce(sum(total_cnt), 0) FROM core.reg_snapshot WHERE base_month = %(base_month)s),
        'changed_dongs', (
            SELECT count(DISTINCT coalesce(o.adm_cd, n.adm_cd))
            FROM (SELECT * FROM core.reg_snapshot WHERE base_month = %(base_month)s) o
            FULL JOIN (SELECT * FROM staging.registration_norm WHERE run_id = %(run_id)s) n
              ON n.adm_cd = o.adm_cd AND n.fuel_cd = o.fuel_cd
            WHERE o.total_cnt IS DISTINCT FROM n.total_cnt)) AS d
)
INSERT INTO ops.reg_load (base_month, source, source_ref, run_id, row_cnt, content_hash, prev_load_id, diff,
                          quality_grade)
SELECT %(base_month)s, %(source)s, %(source_ref)s, %(run_id)s, %(row_cnt)s, %(content_hash)s,
       (SELECT load_id FROM prev),
       CASE WHEN EXISTS (SELECT 1 FROM prev) THEN (SELECT d FROM diff) END,
       %(quality_grade)s
RETURNING load_id, prev_load_id;
