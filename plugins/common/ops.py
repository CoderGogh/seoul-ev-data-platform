# 운영 기록: 실행 상태·품질 결과 (Airflow 실행 상태와 별개인 데이터 상태)
import json

from common import db

UPSERT_RUN = """
INSERT INTO ops.pipeline_run (dag_id, run_id, logical_date, partition_key, status, status_reason, trigger_type, detail,
                              finished_at)
VALUES (%(dag_id)s, %(run_id)s, %(logical_date)s, %(partition_key)s, %(status)s, %(reason)s, %(trigger_type)s,
        %(detail)s, CASE WHEN %(status)s = 'running' THEN NULL ELSE now() END)
ON CONFLICT (dag_id, run_id) DO UPDATE
SET status = EXCLUDED.status, status_reason = EXCLUDED.status_reason,
    partition_key = coalesce(EXCLUDED.partition_key, ops.pipeline_run.partition_key),
    detail = coalesce(ops.pipeline_run.detail, '{}'::jsonb) || coalesce(EXCLUDED.detail, '{}'::jsonb),
    finished_at = EXCLUDED.finished_at
"""

UPSERT_QUALITY = """
INSERT INTO ops.quality_result (dag_id, run_id, check_name, scope_key, grade, metric, threshold, detail)
VALUES (%(dag_id)s, %(run_id)s, %(check_name)s, %(scope_key)s, %(grade)s, %(metric)s, %(threshold)s, %(detail)s)
ON CONFLICT (dag_id, run_id, check_name, scope_key) DO UPDATE
SET grade = EXCLUDED.grade, metric = EXCLUDED.metric, threshold = EXCLUDED.threshold, detail = EXCLUDED.detail,
    checked_at = now()
"""


# 트리거 유형 (cron / asset / manual)
def trigger_type(context):
    dr = context["dag_run"]
    return str(getattr(dr, "run_type", "") or "").split(".")[-1].lower() or None


def record_run(context, status, partition_key=None, reason=None, detail=None):
    dr = context["dag_run"]
    db.execute(
        UPSERT_RUN,
        {
            "dag_id": dr.dag_id,
            "run_id": dr.run_id,
            "logical_date": dr.logical_date,
            "partition_key": partition_key,
            "status": status,
            "reason": reason,
            "trigger_type": trigger_type(context),
            "detail": json.dumps(detail or {}, ensure_ascii=False, default=str),
        },
    )


def record_quality(context, check_name, grade, metric=None, threshold=None, scope_key="*", detail=None):
    dr = context["dag_run"]
    db.execute(
        UPSERT_QUALITY,
        {
            "dag_id": dr.dag_id,
            "run_id": dr.run_id,
            "check_name": check_name,
            "scope_key": scope_key,
            "grade": grade,
            "metric": metric,
            "threshold": threshold,
            "detail": json.dumps(detail or {}, ensure_ascii=False, default=str),
        },
    )


# 같은 실행의 Task 상태 조회 (최종 상태 확정용)
def task_states(context, task_ids):
    ti = context["ti"]
    dr = context["dag_run"]
    states = ti.get_task_states(dag_id=dr.dag_id, task_ids=list(task_ids), run_ids=[dr.run_id])
    return {k: (str(v) if v is not None else None) for k, v in states.get(dr.run_id, {}).items()}
