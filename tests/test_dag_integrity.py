# DAG 운영 정책 검사 (설계서 §12) — 설계 원칙을 CI로 강제
from pathlib import Path

import pytest
from airflow.dag_processing.dagbag import DagBag

DAG_FOLDER = Path(__file__).resolve().parents[1] / "dags"

# DAG별 동시 실행 정책 (설계서 §2)
MAX_ACTIVE_RUNS = {
    "ev01_traffic_collect": 1,
    "ev02_registration_monthly": 1,
    "ev03_mart_integration": 1,
    "ev10_master_refresh": 1,
    "ev11_reprocess": 1,
    "ev12_quality_monitor": 1,
}
# 외부 API 호출 Task의 Pool·큐
API_TASKS = {
    ("ev01_traffic_collect", "extract_chunk"): "seoul_traffic_api_pool",
    ("ev02_registration_monthly", "extract_reg_api"): "seoul_registration_api_pool",
}


@pytest.fixture(scope="session")
def dagbag():
    return DagBag(dag_folder=str(DAG_FOLDER))  # 예제는 conftest 환경변수로 비활성


def dags(dagbag):
    return list(dagbag.dags.values())


# import 오류 없음
def test_no_import_errors(dagbag):
    assert not dagbag.import_errors, dagbag.import_errors


# 공통 정책: 소급 실행 금지, 태그, 재시도
def test_common_policy(dagbag):
    for dag in dags(dagbag):
        assert dag.catchup is False, f"{dag.dag_id}: catchup=False 필요"
        assert dag.tags, f"{dag.dag_id}: tags 필요"
        assert dag.dag_id.startswith("ev"), f"{dag.dag_id}: ev 접두어 필요"
        for task in dag.tasks:
            assert task.retries >= 1 or task.task_type.endswith("Sensor"), f"{dag.dag_id}.{task.task_id}: retries 필요"


# 동시 실행 제한
def test_max_active_runs(dagbag):
    for dag in dags(dagbag):
        if dag.dag_id in MAX_ACTIVE_RUNS:
            assert dag.max_active_runs == MAX_ACTIVE_RUNS[dag.dag_id], dag.dag_id


# API 호출 Task의 Pool·큐 지정
def test_api_task_pool_and_queue(dagbag):
    for (dag_id, task_id), pool in API_TASKS.items():
        dag = dagbag.dags.get(dag_id)
        if dag is None or task_id not in dag.task_dict:
            continue
        task = dag.task_dict[task_id]
        assert task.pool == pool, f"{dag_id}.{task_id}: pool={task.pool}"
        assert task.queue == "api", f"{dag_id}.{task_id}: queue={task.queue}"


# 센서는 reschedule 모드 (워커 슬롯 비점유)
def test_sensor_reschedule(dagbag):
    for dag in dags(dagbag):
        for task in dag.tasks:
            if hasattr(task, "mode"):
                assert task.mode == "reschedule", f"{dag.dag_id}.{task.task_id}: mode={task.mode}"


# 최종 상태 확정 Task: leaf 하나, all_done
def test_single_all_done_leaf(dagbag):
    for dag in dags(dagbag):
        if dag.dag_id not in ("ev01_traffic_collect", "ev02_registration_monthly", "ev03_mart_integration"):
            continue
        leaves = [t for t in dag.tasks if not t.downstream_task_ids]
        assert len(leaves) == 1, f"{dag.dag_id}: leaf {[t.task_id for t in leaves]}"
        assert leaves[0].trigger_rule == "all_done", f"{dag.dag_id}.{leaves[0].task_id}: {leaves[0].trigger_rule}"
