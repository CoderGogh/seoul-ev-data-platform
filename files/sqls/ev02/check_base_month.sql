-- 원천 기준월 분포 (대상 기준월과 일치해야 함)
SELECT stats_ym, count(*) AS n
FROM staging.registration_raw
WHERE run_id = %(run_id)s
GROUP BY stats_ym;
