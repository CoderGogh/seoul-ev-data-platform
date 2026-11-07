"""ev12 품질 리포트 (설계서 §4.7)

[Airflow 실행 상태 수집 (메타DB)] + [데이터 상태 수집 (ops)] 병렬 → 불일치 탐지 → 리포트 → Slack → 상태 확정
- DAG 가 성공이어도 데이터는 partial·held 일 수 있음 → 두 원천을 조인해 불일치를 드러냄
- 메타DB 는 조회만 (conn_db_postgres_airflow)
"""

from contextlib import closing

import config.slack_block_builder as sb
import pendulum
from airflow.providers.postgres.hooks.postgres import PostgresHook
from airflow.providers.slack.hooks.slack_webhook import SlackWebhookHook
from airflow.sdk import DAG, CronTriggerTimetable, Param, Variable, task
from airflow.sdk.exceptions import AirflowFailException
from common import api_usage, db, ops
from config.default_args import DEFAULT_ARGS
from hooks.seoul_openapi_hook import LIMIT

KST = "Asia/Seoul"
META_CONN = "conn_db_postgres_airflow"
EXPECTED_EV01_PER_DAY = 48  # 30분 주기
EXPECTED_EV04_PER_DAY = 1  # 05:00 일 배치
MAX_CHARGER_LAG_DAYS = 0  # 리포트(08:00) 시점에 당일 확인 필요
LIMIT_VAR = "ev01_daily_call_limit"  # 일 호출 한도 (미설정 시 한도 오류만 감시)
DATA_ISSUES = ("partial", "held", "failed", "publication_delayed", "skipped_stale", "no_eligible_period")
FINAL_TASKS = ["collect_airflow_runs", "collect_data_status", "detect_mismatch", "build_report", "send_slack"]


def _meta_query(sql, params):
    with closing(PostgresHook(postgres_conn_id=META_CONN).get_conn()) as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


# 호출량 칸: 하루 환산 호출량·한도, 한도 오류
def _usage_field(u, m):
    limit = f" / 한도 {m['daily_limit']:,}" if m["daily_limit"] else ""
    warn = " :warning:" if m["limit_grade"] != "ok" else ""
    return f"*호출량*{warn}: 하루 {m['daily_calls']:,}건{limit}, 한도 오류 {int(u['limit_errors'])}건"


# 오류율 칸: 회차 등급 분포·p50/p95/최대
def _error_rate_field(u):
    if not u["batches"]:
        return "*오류율*: 기록 없음"
    return (
        f"*오류율 등급*: ok {int(u['ok_cnt'])}·warn {int(u['warn_cnt'])}·fatal {int(u['fatal_cnt'])}\n"
        f"p50 {u['p50']:.1%} / p95 {u['p95']:.1%} / 최대 {u['max']:.1%}"
    )


# 연속 보류 줄: 마지막 게시·무변경 이후 보류 일수
def _hold_line(h):
    if not h["days"]:
        return f"*연속 보류*: 없음 (마지막 게시·무변경 {h['last_ok_day'] or '-'})"
    return (
        f"*연속 보류* :warning: {h['days']}일 ({h['held_since']}부터, 마지막 게시·무변경 {h['last_ok_day'] or '없음'})"
    )


# 충전기 줄: 마지막 확인일·최근 적재 건수·현재 대수, 누락 시 경고 표시
def _charger_line(c, m):
    head = "*충전기*" + (" :warning: 확인 누락" if m["charger_missed"] else "")
    check = (
        f"마지막 확인 {c['last_check_date'] or '없음'} ({c['last_status'] or '-'}), "
        f"실행 {m['ev04_runs']} / 기대 {m['ev04_expected']}"
    )
    load = (
        f"최근 적재 {c['load_date']} 신규 {c['new_cnt']}·변경 {c['changed_cnt']}·소멸 {c['closed_cnt']} ({c['quality_grade']})"
        if c["load_date"]
        else "적재 이력 없음"
    )
    return f"{head}: {check}\n{load}, 현재 {c['current_cnt']}대"


with DAG(
    dag_id="ev12_quality_monitor",
    description="Airflow 실행 상태 × 데이터 상태 교차 리포트",
    schedule=CronTriggerTimetable("0 8 * * *", timezone=KST),
    start_date=pendulum.datetime(2026, 10, 27, tz=KST),
    catchup=False,
    max_active_runs=1,
    default_args=DEFAULT_ARGS,
    params={"hours": Param(24, type="integer", minimum=1, description="조회 기간 (시간)")},
    tags=["ev", "monitor"],
) as dag:

    # Airflow 실행 상태 (메타DB 조회 전용)
    @task
    def collect_airflow_runs(**context):
        rows = _meta_query(
            """SELECT dag_id, run_id, state, run_type, start_date, end_date FROM dag_run
               WHERE dag_id LIKE 'ev%%' AND run_after >= now() - make_interval(hours => %(h)s)""",
            {"h": context["params"]["hours"]},
        )
        return [{**r, "start_date": str(r["start_date"]), "end_date": str(r["end_date"])} for r in rows]

    # 데이터 상태 (ops): 실행 결과·커버리지·게시·등록 최신성·활성 마스터·충전기
    @task
    def collect_data_status(**context):
        h = {"h": context["params"]["hours"]}
        runs = db.execute(
            """SELECT dag_id, run_id, status, status_reason FROM ops.pipeline_run
               WHERE started_at >= now() - make_interval(hours => %(h)s)""",
            h,
            fetch=True,
        )
        cov = db.execute(
            """SELECT count(*) AS batches, round(avg(100.0 * ok_cnt / target_cnt), 2) AS avg_ok_pct,
                      round(min(100.0 * ok_cnt / target_cnt), 2) AS min_ok_pct,
                      coalesce(sum(api_error_cnt), 0) AS api_errors
               FROM ops.poll_coverage WHERE collected_at >= now() - make_interval(hours => %(h)s)""",
            h,
            fetch=True,
        )[0]
        publish = db.execute("SELECT base_month, status, reason FROM ops.publish_status ORDER BY 1", fetch=True)
        reg = db.execute("SELECT max(base_month) AS latest, max(loaded_at) AS loaded_at FROM ops.reg_load", fetch=True)[
            0
        ]
        masters = db.execute(
            "SELECT master_type, version FROM core.master_version WHERE status = 'active' ORDER BY 1", fetch=True
        )
        charger = db.execute_file("ev12/charger_status.sql", fetch=True)[0]
        hold = db.execute_file("ev12/hold_streak.sql", fetch=True)[0]
        usage = db.execute_file("ev12/api_usage.sql", {"hours": h["h"], "limit_code": LIMIT}, fetch=True)[0]
        return {
            "runs": runs,
            "coverage": {k: (float(v) if v is not None else None) for k, v in cov.items()},
            "publish": publish,
            "reg": {"latest": reg["latest"], "loaded_at": str(reg["loaded_at"])},
            "masters": masters,
            "hold": {"days": hold["held_days"], **{k: hold[k] and str(hold[k]) for k in ("held_since", "last_ok_day")}},
            "usage": {k: (float(v) if v is not None else None) for k, v in usage.items()},
            "charger": {k: (str(v) if k in ("last_check_date", "load_date") and v else v) for k, v in charger.items()},
        }

    # 불일치: Airflow 성공 + 데이터 문제 / 데이터 기록 누락 / 수집 회차 부족 / 충전기 확인 누락
    @task
    def detect_mismatch(airflow_runs, data, **context):
        data_by_run = {(r["dag_id"], r["run_id"]): r for r in data["runs"]}
        silent = [
            {"dag_id": a["dag_id"], "run_id": a["run_id"], "data": d["status"], "reason": d["status_reason"]}
            for a in airflow_runs
            if a["state"] == "success" and (d := data_by_run.get((a["dag_id"], a["run_id"])))
            and d["status"] in DATA_ISSUES
        ]  # fmt: skip
        unrecorded = [
            {"dag_id": a["dag_id"], "run_id": a["run_id"], "airflow": a["state"]}
            for a in airflow_runs
            if a["state"] in ("success", "failed") and (a["dag_id"], a["run_id"]) not in data_by_run
            and a["dag_id"] != "ev12_quality_monitor"
        ]  # fmt: skip
        ev01_runs = sum(1 for a in airflow_runs if a["dag_id"] == "ev01_traffic_collect")
        expected = EXPECTED_EV01_PER_DAY * context["params"]["hours"] // 24
        # 충전기: 실행 회차 + 마지막 확인일 (무변경 포함)
        ev04_runs = sum(1 for a in airflow_runs if a["dag_id"] == "ev04_charger_daily")
        ev04_expected = EXPECTED_EV04_PER_DAY * context["params"]["hours"] // 24
        lag = data["charger"]["lag_days"]
        charger_missed = ev04_runs < ev04_expected or lag is None or lag > MAX_CHARGER_LAG_DAYS
        result = {
            "silent_issues": silent, "unrecorded": unrecorded, "ev01_runs": ev01_runs, "ev01_expected": expected,
            "ev04_runs": ev04_runs, "ev04_expected": ev04_expected, "charger_lag_days": lag,
            "charger_missed": charger_missed,
        }  # fmt: skip
        # 호출량: 하루 환산, 한도 오류·임박 판정
        u = data["usage"]
        hours = context["params"]["hours"]
        daily_calls = int(u["calls"] * 24 / hours)
        daily_limit = Variable.get(LIMIT_VAR, default=None)
        daily_limit = int(daily_limit) if daily_limit else None
        limit_grade = api_usage.grade_limit(u["limit_errors"], daily_calls, daily_limit)
        ops.record_quality(
            context, "api_usage", limit_grade, daily_calls, daily_limit,
            detail={**u, "daily_calls": daily_calls, "daily_limit": daily_limit},
        )  # fmt: skip
        result.update(daily_calls=daily_calls, daily_limit=daily_limit, limit_grade=limit_grade)
        grade = "warn" if silent or unrecorded or ev01_runs < expected else "ok"
        ops.record_quality(context, "state_mismatch", grade, len(silent) + len(unrecorded), 0, detail=result)
        ops.record_quality(
            context, "charger_daily", "warn" if charger_missed else "ok", lag, MAX_CHARGER_LAG_DAYS,
            detail={"ev04_runs": ev04_runs, "ev04_expected": ev04_expected, **data["charger"]},
        )  # fmt: skip
        return result

    @task
    def build_report(airflow_runs, data, mismatch, **context):
        states = {}
        for a in airflow_runs:
            s = states.setdefault(a["dag_id"], {})
            s[a["state"]] = s.get(a["state"], 0) + 1
        data_states = {}
        for r in data["runs"]:
            s = data_states.setdefault(r["dag_id"], {})
            s[r["status"]] = s.get(r["status"], 0) + 1
        hours = context["params"]["hours"]
        now = pendulum.now(KST).format("YYYY-MM-DD HH:mm")
        cov = data["coverage"]
        blocks = [
            sb.section_text(f"*전동화 입지 파이프라인 품질 리포트* (최근 {hours}시간, {now})"),
            sb.divider(),
            sb.section_text("*1. 실행 상태 (Airflow) × 데이터 상태 (ops)*"),
        ]
        for dag_id in sorted(set(states) | set(data_states)):
            blocks.append(
                sb.section_text(f"`{dag_id}`\nAirflow {states.get(dag_id, {})}\n데이터 {data_states.get(dag_id, {})}")
            )
        blocks += [
            sb.divider(),
            sb.section_text(f"*2. 불일치* ({len(mismatch['silent_issues'])}건 성공 표시 속 데이터 문제)"),
        ]
        for m in mismatch["silent_issues"][:10]:
            blocks.append(sb.section_text(f"• {m['dag_id']} `{m['run_id'][:40]}` → *{m['data']}* {m['reason'] or ''}"))
        if mismatch["unrecorded"]:
            blocks.append(sb.section_text(f"• 데이터 기록 없는 실행 {len(mismatch['unrecorded'])}건"))
        blocks += [
            sb.divider(),
            sb.fields(
                [
                    f"*수집 회차*: {mismatch['ev01_runs']} / 기대 {mismatch['ev01_expected']}",
                    f"*정상 응답률*: 평균 {cov['avg_ok_pct']}% / 최저 {cov['min_ok_pct']}%",
                    f"*API 오류*: {cov['api_errors']}건",
                    _usage_field(data["usage"], mismatch),
                    _error_rate_field(data["usage"]),
                    f"*등록 최신 기준월*: {data['reg']['latest']}",
                ]
            ),  # fmt: skip
            sb.section_text(_charger_line(data["charger"], mismatch)),
            sb.section_text(_hold_line(data["hold"])),
            sb.section_text("*게시 상태*: " + ", ".join(f"{p['base_month']} {p['status']}" for p in data["publish"])),
            sb.section_text(
                "*활성 마스터*: " + ", ".join(f"{m['master_type']}={m['version']}" for m in data["masters"])
            ),
        ]
        return blocks

    @task
    def send_slack(blocks):
        SlackWebhookHook(slack_webhook_conn_id="conn_slack_airflow_bot").send(
            text="파이프라인 품질 리포트", blocks=blocks
        )

    @task(trigger_rule="all_done")
    def record_run(**context):
        states = ops.task_states(context, FINAL_TASKS)
        failed = [t for t, s in states.items() if s in ("failed", "upstream_failed")]
        if failed:
            ops.record_run(context, "failed", reason=f"실패 Task: {failed}")
            raise AirflowFailException(f"리포트 실패: {failed}")
        m = context["ti"].xcom_pull(task_ids="detect_mismatch")
        ops.record_run(context, "success", reason=f"불일치 {len(m['silent_issues'])}건", detail=m)

    airflow_runs = collect_airflow_runs()
    data = collect_data_status()
    mismatch = detect_mismatch(airflow_runs, data)
    blocks = build_report(airflow_runs, data, mismatch)
    sent = send_slack(blocks)
    sent >> record_run()
