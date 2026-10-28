"""ev03 통합 마트 (설계서 §4.3)

대상 기준월 결정 → [Gate 1: 5개 점검 병렬] → 판정 분기(보류 | 변경 없음 | 진행)
→ 귀속 확인 → 시간대 집계 → 지표 → Gate 2 → 분류 → 후보 검증 → 게시(단일 트랜잭션) → 결과 확정
- 수집 DAG 성공을 기다리지 않고 DB 상태를 조회 (cron 또는 Asset 이벤트로 시작)
- Asset 이벤트는 힌트일 뿐, 대상 기준월은 DB 와 params 로 결정
"""

import pendulum
from airflow.providers.slack.hooks.slack_webhook import SlackWebhookHook
from airflow.providers.standard.operators.empty import EmptyOperator
from airflow.sdk import DAG, AssetOrTimeSchedule, CronTriggerTimetable, Label, Param, TaskGroup, task
from airflow.sdk.exceptions import AirflowFailException
from common import db, ops
from common.assets import EV_MART_PUBLISHED, EV_MASTER_VERSION, EV_REG_SNAPSHOT
from config.default_args import DEFAULT_ARGS

KST = "Asia/Seoul"
GATE = "gate1_run_eligibility"
CHECKS = ["check_reg_snapshot", "check_traffic_freshness", "check_coverage", "check_master_version",
          "check_min_timebands"]  # fmt: skip
MIN_RUN_COVERAGE = 60  # 실행 전체 커버리지 % (Gate 1)
MIN_RUN_HOURS = 6  # 관측된 주간 시간대 수 (Gate 1)
FINAL_TASKS = ["resolve_target_period", "no_eligible_period", *[f"{GATE}.{c}" for c in CHECKS], "evaluate_gate1",
               "hold_publish", "mark_stale_and_alert", "skip_unchanged", "spatial_join", "admdong_timeband_agg",
               "compute_indicators", "region_quality_gate", "classify_abc", "verify_candidate",
               "publish_mart"]  # fmt: skip


def _info(context):
    return context["ti"].xcom_pull(task_ids="resolve_target_period", key="info")


def _metrics(context):
    i = _info(context)
    return db.execute_file("ev03/gate1_checks.sql", i, fetch=True)[0]


with DAG(
    dag_id="ev03_mart_integration",
    description="사용 가능 상태 확인 → 지표·분류 → 마트 게시",
    schedule=AssetOrTimeSchedule(
        timetable=CronTriggerTimetable("0 6 * * *", timezone=KST), assets=(EV_REG_SNAPSHOT | EV_MASTER_VERSION)
    ),
    start_date=pendulum.datetime(2026, 10, 27, tz=KST),
    catchup=False,
    max_active_runs=1,  # 동시 게시 방지
    default_args=DEFAULT_ARGS,
    params={
        "base_month": Param(None, type=["null", "string"], pattern=r"^\d{6}$", description="비우면 최신 스냅샷"),
        "window_start": Param("2026-10-27T17:30:00+09:00", type="string", description="도로 분석 기간 시작 (MVP)"),
        "window_end": Param(
            "2026-10-28T12:00:00+09:00", type="string", description="도로 분석 기간 끝 (MVP, 제출일 정오)"
        ),
        "target_set": Param("mvp_3gu_v1", type="string"),
        "force": Param(False, type="boolean", description="fingerprint 비교 생략"),
        "request_id": Param(None, type=["null", "integer"]),
    },
    tags=["ev", "mart"],
) as dag:

    # 대상 기준월·입력 fingerprint 결정. 스냅샷 없으면 입력 대기
    @task.branch
    def resolve_target_period(**context):
        p = context["params"]
        hints = [e.extra.get("base_month") for evs in context["triggering_asset_events"].values() for e in evs
                 if e.extra and e.extra.get("base_month")]  # fmt: skip
        args = {"base_month": p["base_month"], "window_start": p["window_start"], "window_end": p["window_end"],
                "target_set": p["target_set"]}  # fmt: skip
        r = db.execute_file("ev03/resolve_target.sql", args, fetch=True)[0]
        info = {**args, **{k: (str(v) if v is not None else None) for k, v in r.items()}}
        info["prev_month"] = r["prev_month"]
        info["reg_load_id"] = r["reg_load_id"]
        info["prev_load_id"] = r["prev_load_id"]
        info["asset_hints"] = hints
        context["ti"].xcom_push(key="info", value=info)
        ops.record_run(context, "running", partition_key=r["base_month"], detail={"asset_hints": hints})
        if r["reg_load_id"] is None or r["threshold_ver"] is None:
            return "no_eligible_period"
        return [f"{GATE}.{c}" for c in CHECKS]

    no_eligible_period = EmptyOperator(task_id="no_eligible_period")

    # Gate 1: 실행 전체 적격성 (5개 점검 병렬, Task 는 실패시키지 않고 결과만 반환)
    with TaskGroup(GATE) as gate1:

        @task
        def check_reg_snapshot(**context):
            m = _metrics(context)
            ok = m["reg_rows"] > 0 and m["prev_rows"] > 0 and m["reg_grade"] != "fatal"
            return {
                "ok": ok,
                "reason": None if ok else f"등록 스냅샷 부족 (당월 {m['reg_rows']}, 전년 {m['prev_rows']})",
            }

        @task
        def check_traffic_freshness(**context):
            m = _metrics(context)
            end = pendulum.parse(_info(context)["window_end"])
            if pendulum.now("UTC") < end:
                return {"ok": False, "reason": f"분석 기간 미종료 (끝 {end.in_timezone(KST):%m-%d %H:%M})"}
            ok = m["last_collected_at"] is not None and m["last_collected_at"] >= end.subtract(hours=1)
            return {"ok": ok, "reason": None if ok else f"수집 지연 (마지막 {m['last_collected_at']})"}

        @task
        def check_coverage(**context):
            m = _metrics(context)
            denom = m["target_links"] * m["expected_hours"]
            cov = round(100 * m["observed_link_hours"] / denom, 2) if denom else 0
            ops.record_quality(context, "run_coverage", "ok" if cov >= MIN_RUN_COVERAGE else "below", cov,
                               MIN_RUN_COVERAGE)  # fmt: skip
            return {"ok": cov >= MIN_RUN_COVERAGE, "reason": None if cov >= MIN_RUN_COVERAGE else f"커버리지 {cov}%"}

        @task
        def check_master_version(**context):
            m = _metrics(context)
            ok = m["active_masters"] == 2 and m["target_on_active_link"]
            return {"ok": ok, "reason": None if ok else "활성 마스터 버전 불일치"}

        @task
        def check_min_timebands(**context):
            m = _metrics(context)
            ok = m["observed_hours"] >= MIN_RUN_HOURS
            return {"ok": ok, "reason": None if ok else f"관측 시간대 {m['observed_hours']}개 < {MIN_RUN_HOURS}"}

        checks = [check_reg_snapshot(), check_traffic_freshness(), check_coverage(), check_master_version(),
                  check_min_timebands()]  # fmt: skip

    # 판정 분기: 미달 → 보류, 입력 동일 → 변경 없음, 그 외 진행
    @task.branch
    def evaluate_gate1(**context):
        results = {c: context["ti"].xcom_pull(task_ids=f"{GATE}.{c}") for c in CHECKS}
        failed = {c: r["reason"] for c, r in results.items() if not r["ok"]}
        context["ti"].xcom_push(key="failed", value=failed)
        info = _info(context)
        if failed:
            return "hold_publish"
        if info["fingerprint"] == info["last_fingerprint"] and not context["params"]["force"]:
            return "skip_unchanged"
        return "spatial_join"

    hold_publish = EmptyOperator(task_id="hold_publish")
    skip_unchanged = EmptyOperator(task_id="skip_unchanged")

    # 이전 결과 유지 + stale 표시 + 알림
    @task
    def mark_stale_and_alert(**context):
        info = _info(context)
        failed = context["ti"].xcom_pull(task_ids="evaluate_gate1", key="failed")
        reason = "; ".join(failed.values())
        db.execute_file("ev03/hold.sql", {"run_id": context["dag_run"].run_id, "base_month": info["base_month"],
                                          "fingerprint": info["fingerprint"], "reason": reason})  # fmt: skip
        try:
            SlackWebhookHook(slack_webhook_conn_id="conn_slack_airflow_bot").send(
                text=f"[ev03] {info['base_month']} 게시 보류: {reason}"
            )
        except Exception:  # 알림 실패는 판정에 영향 없음
            pass

    # 활성 버전 기준 링크-행정동 귀속 재사용 확인
    @task
    def spatial_join(**context):
        r = db.execute(
            """SELECT count(*) AS n FROM core.target_link t
               JOIN core.master_version v ON v.master_type = 'link' AND v.version = t.link_ver AND v.status = 'active'
               WHERE t.target_set = %(target_set)s""",
            _info(context),
            fetch=True,
        )[0]
        if r["n"] == 0:
            raise AirflowFailException("활성 버전 귀속 결과 없음")
        return r["n"]

    def _run_args(context):
        i = _info(context)
        return {**i, "run_id": context["dag_run"].run_id, "request_id": context["params"]["request_id"]}

    @task
    def admdong_timeband_agg(**context):
        db.execute_file("ev03/admdong_timeband.sql", _run_args(context))

    @task
    def compute_indicators(**context):
        db.execute_file("ev03/indicators.sql", _run_args(context))

    # Gate 2: 지역별 품질 등급
    @task
    def region_quality_gate(**context):
        rows = db.execute_file("ev03/region_gate.sql", _run_args(context), fetch=True)
        grades = {g: sum(1 for r in rows if r["quality_grade"] == g) for g in ("ok", "warn", "below", "fatal")}
        for g, n in grades.items():
            ops.record_quality(context, f"region_{g}", g, n)
        return grades

    @task
    def classify_abc(**context):
        rows = db.execute_file("ev03/classify.sql", _run_args(context), fetch=True)
        return {c: sum(1 for r in rows if r["classification"] == c) for c in ("A", "B", "C", "REF", "WITHHELD")}

    # 후보 완전성: 대상 행정동 전체·키 중복 없음·분류 null 없음·우선 검토 지역 유형 누락 없음
    @task
    def verify_candidate(**context):
        r = db.execute(
            """SELECT count(*) AS n, count(DISTINCT adm_cd) AS uniq,
                      count(*) FILTER (WHERE classification IS NULL) AS nulls,
                      count(*) FILTER (WHERE classification = 'A' AND charger_hint IS NULL) AS a_no_hint,
                      (SELECT count(*) FROM mart.dim_admdong d WHERE d.sgg_nm IN (
                           SELECT DISTINCT a.sgg_nm FROM core.target_link t
                           JOIN core.admdong a ON a.boundary_ver = t.boundary_ver AND a.adm_cd = t.adm_cd
                           WHERE t.target_set = %(target_set)s)) AS expected
               FROM mart.candidate_admdong_indicator WHERE run_id = %(run_id)s""",
            _run_args(context),
            fetch=True,
        )[0]
        ok = r["n"] == r["expected"] == r["uniq"] and r["nulls"] == 0 and r["a_no_hint"] == 0
        ops.record_quality(context, "candidate_complete", "ok" if ok else "fatal", r["n"], r["expected"], detail=r)
        if not ok:
            raise AirflowFailException(f"후보 불완전: {r}")

    # 파티션 교체 + 계보 단일 트랜잭션, 성공 시에만 Asset 이벤트
    @task(outlets=[EV_MART_PUBLISHED])
    def publish_mart(**context):
        args = _run_args(context)
        db.execute_file("ev03/publish.sql", args)
        context["outlet_events"][EV_MART_PUBLISHED].extra = {"base_month": args["base_month"]}

    @task(trigger_rule="all_done")
    def record_run_result(**context):
        states = ops.task_states(context, FINAL_TASKS)
        info = _info(context) or {}
        bm = info.get("base_month")
        failed = [t for t, s in states.items() if s in ("failed", "upstream_failed")]
        if failed:
            ops.record_run(context, "failed", bm, reason=f"실패 Task: {failed} (운영 마트 변경 없음)")
            raise AirflowFailException(f"핵심 처리 실패: {failed}")
        ti = context["ti"]
        if states.get("no_eligible_period") == "success":
            ops.record_run(context, "no_eligible_period", bm, reason="등록 스냅샷 또는 임계값 없음")
        elif states.get("skip_unchanged") == "success":
            ops.record_run(context, "skipped_unchanged", bm, reason="입력 fingerprint 동일")
        elif states.get("mark_stale_and_alert") == "success":
            failed_checks = ti.xcom_pull(task_ids="evaluate_gate1", key="failed")
            ops.record_run(context, "held", bm, reason="; ".join(failed_checks.values()))
        else:
            dist = ti.xcom_pull(task_ids="classify_abc")
            ops.record_run(context, "published", bm, reason=str(dist), detail={"classification": dist})

    resolved = resolve_target_period()
    evaluated = evaluate_gate1()
    stale = mark_stale_and_alert()
    joined = spatial_join()
    tb = admdong_timeband_agg()
    ind = compute_indicators()
    g2 = region_quality_gate()
    cls = classify_abc()
    verified = verify_candidate()
    published = publish_mart()
    final = record_run_result()

    # 분기 사유 라벨 (Graph 화면 표시)
    resolved >> Label("입력 없음") >> no_eligible_period
    resolved >> Label("대상 기준월 확정") >> gate1
    gate1 >> evaluated
    evaluated >> Label("Gate 1 미달") >> hold_publish
    evaluated >> Label("입력 지문 동일") >> skip_unchanged
    evaluated >> Label("통과") >> joined
    hold_publish >> Label("이전 결과 유지") >> stale
    joined >> tb >> ind >> g2 >> Label("지역별 품질 등급") >> cls >> verified >> Label("검증 통과") >> published
    [no_eligible_period, stale, skip_unchanged, published] >> Label("all_done") >> final
