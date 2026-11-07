-- ev03 연속 보류: 마지막 게시·무변경 이후 보류된 날 수
WITH d AS (
    SELECT (started_at AT TIME ZONE 'Asia/Seoul')::date AS day,
           bool_or(status IN ('published', 'republished', 'skipped_unchanged')) AS ok,
           bool_or(status = 'held') AS held
    FROM ops.pipeline_run
    WHERE dag_id = 'ev03_mart_integration'
    GROUP BY 1
),
last_ok AS (SELECT max(day) AS day FROM d WHERE ok)
SELECT count(*) AS held_days, min(d.day) AS held_since, (SELECT day FROM last_ok) AS last_ok_day
FROM d
WHERE d.held AND NOT d.ok AND d.day > coalesce((SELECT day FROM last_ok), '-infinity'::date);
