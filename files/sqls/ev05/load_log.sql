-- 적재 이력 기록 (스냅샷 교체와 같은 트랜잭션)
-- 파라미터: snapshot_date, run_id, sgg_cds, quality_grade
INSERT INTO ops.aux_load (snapshot_date, run_id, sgg_cds, apt_cnt, apt_hh_cnt, parking_cnt, parking_space_cnt,
                          quality_grade)
SELECT %(snapshot_date)s, %(run_id)s, %(sgg_cds)s,
       (SELECT count(*) FROM staging.apt_norm WHERE run_id = %(run_id)s),
       (SELECT coalesce(sum(hh_cnt), 0) FROM staging.apt_norm WHERE run_id = %(run_id)s),
       (SELECT count(*) FROM staging.parking_norm WHERE run_id = %(run_id)s),
       (SELECT coalesce(sum(space_cnt), 0) FROM staging.parking_norm WHERE run_id = %(run_id)s),
       %(quality_grade)s
RETURNING load_id, apt_cnt, apt_hh_cnt, parking_cnt, parking_space_cnt;
