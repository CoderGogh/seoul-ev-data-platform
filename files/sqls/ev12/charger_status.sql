-- 충전기 수집 상태 (ev04): 마지막 확인일·최근 적재·현재 대수
-- 확인일 = 반영(success) 또는 무변경(unchanged) 실행의 수집일, 무변경은 적재 이력 없음
WITH chk AS (
    SELECT max(partition_key)::date AS last_check_date
    FROM ops.pipeline_run
    WHERE dag_id = 'ev04_charger_daily' AND status IN ('success', 'unchanged')
),
last_run AS (
    SELECT status, status_reason, started_at
    FROM ops.pipeline_run
    WHERE dag_id = 'ev04_charger_daily'
    ORDER BY started_at DESC
    LIMIT 1
),
last_load AS (
    SELECT snapshot_date, new_cnt, changed_cnt, closed_cnt, quality_grade
    FROM ops.charger_load
    ORDER BY load_id DESC
    LIMIT 1
)
SELECT chk.last_check_date,
       (now() AT TIME ZONE 'Asia/Seoul')::date - chk.last_check_date AS lag_days,
       last_run.status AS last_status,
       last_run.status_reason AS last_reason,
       last_load.snapshot_date AS load_date,
       last_load.new_cnt, last_load.changed_cnt, last_load.closed_cnt, last_load.quality_grade,
       (SELECT count(*) FROM core.charger WHERE valid_to IS NULL) AS current_cnt
FROM chk
LEFT JOIN last_run ON true
LEFT JOIN last_load ON true;
