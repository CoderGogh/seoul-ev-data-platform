"""ev14 웹 데이터 게시 (설계서 §4.9)

게시 상태 확인 → JSON 내보내기 → 묶음 검증 → 원격 비교 → 데이터 브랜치 커밋(원자적) → 상태 확정
- 시작: ev03 게시(ev_mart_published)·ev04 공급 변경(ev_charger_supply) Asset 또는 매일 07:10 (재평가 시각 반영)
- 반영: 저장소 web-data 브랜치에 커밋 하나로 (main 보호 규칙·코드 배포와 분리). 웹은 커밋 SHA 고정으로 읽음
- 실패해도 게시 결과(mart)·웹의 이전 데이터는 그대로 (커밋 전 검증, 커밋은 fast-forward 한 번)
"""

import json

import pendulum
from airflow.providers.standard.operators.empty import EmptyOperator
from airflow.sdk import DAG, AssetOrTimeSchedule, CronTriggerTimetable, task
from airflow.sdk.exceptions import AirflowFailException
from common import db, ops, web_bundle
from common.assets import EV_CHARGER_SUPPLY, EV_MART_PUBLISHED
from config.default_args import DEFAULT_ARGS
from hooks.github_data_hook import GitHubDataHook, blob_sha, changed_files, dumps

KST = "Asia/Seoul"
OUT_DIR = "web"  # 데이터 브랜치 내 경로
FINAL_TASKS = ["check_publish_state", "no_publish", "export_bundle", "validate_bundle", "compare_remote",
               "skip_unchanged", "commit_bundle"]  # fmt: skip


def _path(name):
    return f"{OUT_DIR}/{name}.json"


def _load(context):
    return json.loads(context["ti"].xcom_pull(task_ids="export_bundle"))


with DAG(
    dag_id="ev14_web_publish",
    description="웹 결과 데이터를 데이터 브랜치에 게시 (게시·공급 변경 시 자동)",
    schedule=AssetOrTimeSchedule(
        timetable=CronTriggerTimetable("10 7 * * *", timezone=KST), assets=(EV_MART_PUBLISHED | EV_CHARGER_SUPPLY)
    ),
    start_date=pendulum.datetime(2026, 11, 2, tz=KST),
    catchup=False,
    max_active_runs=1,  # 동시 커밋 방지
    default_args=DEFAULT_ARGS,
    tags=["ev", "web", "publish"],
) as dag:

    # 게시된 기준월이 있어야 진행 (없으면 웹 데이터 유지)
    @task.branch
    def check_publish_state(**context):
        r = db.execute("SELECT count(*) AS n FROM ops.publish_status WHERE status = 'current'", fetch=True)[0]
        ops.record_run(context, "running")
        return "export_bundle" if r["n"] else "no_publish"

    no_publish = EmptyOperator(task_id="no_publish")

    # files/sqls/web/*.sql → JSON (XCom 은 문자열 하나, 약 400KB)
    @task
    def export_bundle():
        return json.dumps(web_bundle.export_all(), ensure_ascii=False, default=str)

    # 게시 결과와 일치·크기 상한. 미달이면 커밋 안 함
    @task
    def validate_bundle(**context):
        bundle = _load(context)
        sizes = {n: len(dumps(v)) for n, v in bundle.items()}
        problems = web_bundle.validate(bundle, sizes)
        ops.record_quality(context, "web_bundle", "fatal" if problems else "ok", len(problems), 0,
                           detail={"problems": problems, "sizes": sizes})  # fmt: skip
        if problems:
            raise AirflowFailException(f"웹 데이터 검증 실패: {problems}")
        return {"sizes": sizes, "base_month": bundle["meta"]["base_month"]}

    # 원격 데이터 브랜치와 비교 (manifest 제외 데이터 파일만)
    @task.branch(pool="github_api_pool", queue="api")
    def compare_remote(**context):
        bundle = _load(context)
        files = {_path(n): dumps(v) for n, v in bundle.items()}
        hook = GitHubDataHook()
        hook.get_conn()
        head = hook.head()
        remote = hook.tree(head) if head else {}
        changed = changed_files(files, remote)
        context["ti"].xcom_push(key="compare", value={"head": head, "changed": changed})
        return "commit_bundle" if changed else "skip_unchanged"

    skip_unchanged = EmptyOperator(task_id="skip_unchanged")

    # 데이터 파일 + manifest 커밋 하나 (비교 시점 head 에서만, 바뀌었으면 실패 → 재시도에서 다시 비교)
    @task(pool="github_api_pool", queue="api", retries=2)
    def commit_bundle(**context):
        bundle = _load(context)
        cmp = context["ti"].xcom_pull(task_ids="compare_remote", key="compare")
        files = {_path(n): dumps(v) for n, v in bundle.items()}
        meta = bundle["meta"]
        man = web_bundle.manifest(
            bundle, {p: blob_sha(c) for p, c in files.items()}, context["dag_run"].run_id,
            pendulum.now(KST).isoformat(),
        )  # fmt: skip
        files["manifest.json"] = dumps(man)
        changed = [p.removeprefix(f"{OUT_DIR}/").removesuffix(".json") for p in cmp["changed"]]
        msg = f"chore: 웹 데이터 갱신 ({meta['base_month']} · {meta['threshold']['ver']} · {', '.join(changed)})"
        res = GitHubDataHook().commit_files(files, msg, expected_head=cmp["head"])
        return res or {"sha": cmp["head"], "changed": []}

    @task(trigger_rule="all_done")
    def record_run(**context):
        states = ops.task_states(context, FINAL_TASKS)
        failed = [t for t, s in states.items() if s in ("failed", "upstream_failed")]
        if failed:
            ops.record_run(context, "failed", reason=f"실패 Task: {failed} (웹 이전 데이터 유지)")
            raise AirflowFailException(f"핵심 처리 실패: {failed}")
        if states.get("no_publish") == "success":
            ops.record_run(context, "skipped_unchanged", reason="게시된 기준월 없음")
        elif states.get("skip_unchanged") == "success":
            ops.record_run(context, "unchanged", reason="웹 데이터 동일")
        else:
            res = context["ti"].xcom_pull(task_ids="commit_bundle") or {}
            base = (context["ti"].xcom_pull(task_ids="validate_bundle") or {}).get("base_month")
            ops.record_run(context, "published", base, reason=f"커밋 {str(res.get('sha'))[:7]} · {res.get('changed')}",
                           detail=res)  # fmt: skip

    branch = check_publish_state()
    exported = export_bundle()
    validated = validate_bundle()
    compare = compare_remote()
    committed = commit_bundle()
    done = record_run()

    branch >> [no_publish, exported]
    exported >> validated >> compare >> [skip_unchanged, committed]
    [no_publish, skip_unchanged, committed] >> done
