-- 수집일 직전 상태 대비 자치구별 변경 건수 (같은 날 재실행해도 비교 기준 동일)
-- 파라미터: run_id, snapshot_date, sgg_cds
WITH n AS (
    SELECT stat_id, chger_id, sgg_cd, attr_hash FROM staging.charger_norm WHERE run_id = %(run_id)s
), o AS (
    SELECT stat_id, chger_id, sgg_cd, attr_hash FROM core.charger
    WHERE sgg_cd = ANY (%(sgg_cds)s)
      AND valid_from < %(snapshot_date)s AND (valid_to IS NULL OR valid_to >= %(snapshot_date)s)
)
SELECT coalesce(n.sgg_cd, o.sgg_cd) AS sgg_cd,
       count(o.stat_id) AS prev_cnt,
       count(n.stat_id) AS cur_cnt,
       count(*) FILTER (WHERE o.stat_id IS NULL) AS new_cnt,
       count(*) FILTER (WHERE n.stat_id IS NOT NULL AND o.stat_id IS NOT NULL AND n.attr_hash <> o.attr_hash) AS changed_cnt,
       count(*) FILTER (WHERE n.stat_id IS NULL) AS closed_cnt
FROM n FULL JOIN o ON o.stat_id = n.stat_id AND o.chger_id = n.chger_id
GROUP BY 1
ORDER BY 1;
