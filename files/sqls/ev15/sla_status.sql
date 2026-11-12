-- 당일(KST) 기한 내 완료 여부·기한 후 완료·마지막 상태 (SLA 판정)
-- 파라미터: dag_id, ok_statuses, deadline_hour
WITH day AS (
    SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date + make_interval(hours => %(deadline_hour)s))
               AT TIME ZONE 'Asia/Seoul' AS deadline_at
)
SELECT %(dag_id)s AS dag_id,
       count(r.run_id) AS runs,
       bool_or(status = ANY (%(ok_statuses)s) AND finished_at <= day.deadline_at) IS TRUE AS met,
       to_char(min(finished_at) FILTER (WHERE status = ANY (%(ok_statuses)s)) AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS done_at,
       (array_agg(status ORDER BY started_at DESC))[1] AS last_status,
       (array_agg(status_reason ORDER BY started_at DESC))[1] AS last_reason
FROM day
LEFT JOIN ops.pipeline_run r
       ON r.dag_id = %(dag_id)s
      AND (r.started_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date
GROUP BY day.deadline_at;
