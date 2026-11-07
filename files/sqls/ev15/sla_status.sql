-- 당일(KST) 실행 중 완료 상태 여부·마지막 상태 (SLA 판정)
-- 파라미터: dag_id, ok_statuses
SELECT %(dag_id)s AS dag_id,
       count(*) AS runs,
       bool_or(status = ANY (%(ok_statuses)s)) IS TRUE AS met,
       (array_agg(status ORDER BY started_at DESC))[1] AS last_status,
       (array_agg(status_reason ORDER BY started_at DESC))[1] AS last_reason
FROM ops.pipeline_run
WHERE dag_id = %(dag_id)s
  AND (started_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date;
