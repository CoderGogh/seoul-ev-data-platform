-- 적재 이력 기록 (이력 반영과 같은 트랜잭션)
-- 파라미터: snapshot_date, run_id, sgg_cds, row_cnt, new_cnt, changed_cnt, closed_cnt, quality_grade
INSERT INTO ops.charger_load (snapshot_date, run_id, sgg_cds, row_cnt, new_cnt, changed_cnt, closed_cnt, quality_grade)
VALUES (%(snapshot_date)s, %(run_id)s, %(sgg_cds)s, %(row_cnt)s, %(new_cnt)s, %(changed_cnt)s, %(closed_cnt)s,
        %(quality_grade)s)
RETURNING load_id;
