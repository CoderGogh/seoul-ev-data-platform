# DAG 설계서 — 서울 전동화 입지 인사이트 플랫폼

| 항목 | 내용 |
|---|---|
| 상태 | 초안 v0.2 (2026-10-27) |
| 근거 | 전동화 입지 인사이트 플랫폼 RFP (v18) |
| 대상 | 현대오토에버 데이터 플랫폼 운영 직무 과제 1 (요구 1: Airflow·선후행) |
| 환경 | Airflow 3.3.2 (CeleryExecutor), PostgreSQL 16 + PostGIS |
| 범위 | DAG·Task 분리, 선후행, 실행 제어, 품질 게이트, 멱등성, 재처리 |

표기
- `[미확정]` API 실증이나 데이터 분포 확인 후 정할 값
- `[소스 확인]` Airflow 3.3.2 소스로 확인한 동작
- `[파싱 검증 예정]` 실제 DAG 실행으로 확인할 동작
- 테이블·컬럼명은 DB 확정 전까지 잠정

---

## 1. 설계 원칙

### 1.1 세 가지 판단 분리

Task가 성공했다고 데이터가 준비된 건 아니다. 그래서 아래 셋을 따로 판단하고 따로 기록한다.

| 판단 | 질문 | 위치 | 미충족 시 |
|---|---|---|---|
| 실행 상태 | 작업이 끝까지 돌았나 | Airflow retry·callback, DAG별 최종 상태 Task | 핵심 단계 실패면 DAG 실패 |
| 데이터 완결성 | 필요한 데이터가 다 모였나 | 수집 DAG의 커버리지·스냅샷 게이트 → `ops` | 일부 실패는 `partial` 기록, 실행은 성공 |
| 데이터 적격성 | 분류 기준을 충족하나 | 통합 DAG의 Gate 1·2 | 게시 보류(`held`) 또는 지역별 C·`WITHHELD`. Task 실패가 아니라 분기 |

### 1.2 구조 원칙

1. 갱신 주기와 실패 조건이 다른 소스는 DAG를 나눈다.
2. 트리거는 시작 계기일 뿐이다. 처리할 기준월과 진행 여부는 DB 상태로 정한다.
3. 모든 적재는 정해진 키 단위로 다시 돌려도 결과가 같다.
4. 재처리는 실패한 Task와 파티션만 한다. 재처리 범위마다 진입 경로는 하나다(§7).
5. 각 DAG의 마지막 Task는 `all_done`으로 항상 실행되고, 이 Task가 최종 상태를 정한다.
6. Task 본문은 얇게 두고 로직은 `files/sqls/<dag>/<task>.sql`에 둔다.

---

## 2. DAG 목록

| dag_id | 책임 | 스케줄 | 트리거 | catchup | max_active_runs | Asset (발생 Task) |
|---|---|---|---|---|---|---|
| `ev01_traffic_collect` | 도로소통 폴링, 관측 이력, 시간대 집계 | `CronTriggerTimetable("*/10 * * * *")` `[미확정]` | cron | False | 1 | `ev_traffic_obs` (`record_coverage`) |
| `ev02_registration_monthly` | 등록현황 월 스냅샷 | `CronTriggerTimetable("0 9 1 * *")` | cron, 수동(`params`) | False | 1 | `ev_reg_snapshot` (`load_snapshot`) |
| `ev03_mart_integration` | 사용 가능 상태 확인 → 지표·분류 → 마트 게시 | `AssetOrTimeSchedule(CronTriggerTimetable("0 6 * * *"), ev_reg_snapshot \| ev_master_version)` | cron 또는 Asset, 수동 | False | 1 | `ev_mart_published` (`publish_mart`) |
| `ev10_master_refresh` | 링크 매핑·행정동 경계 버전 갱신 | None | 수동 | False | 1 | `ev_master_version` (`activate_version`) |
| `ev11_reprocess` | 재처리 요청 진입점 | None | 수동(`params`) | False | 1 | — |
| `ev12_quality_monitor` | 실행 상태·데이터 상태 교차 리포트 | `0 8 * * *` | cron | False | 1 | — |
| `ev13_retention_cleanup` | 조건부 보존 정리 | `0 3 * * 0` | cron | False | 1 | — |

- 핵심은 ev01~03(RFP §07의 DAG 3개). ev10~13은 운영 확장.
- 공통 `default_args`: `retries`, `retry_exponential_backoff=True`, `max_retry_delay`, `on_failure_callback`(Slack), `execution_timeout`.
- Asset 이벤트는 Task가 성공했을 때만 나간다 `[소스 확인]`. 그래서 Asset은 검증을 통과한 뒤의 Task에만 붙인다.
- 타임존은 `Asia/Seoul`. `logical_date`는 UTC로 저장되니 월 경계는 KST로 바꿔서 계산한다.

---

## 3. DAG 간 관계

```
                     ┌──────────── PostgreSQL + PostGIS ────────────┐
 ev01_traffic_collect ──write──▶ core 관측 이력·링크 시간대 집계   ◀──read── ev03_mart_integration
   (Asset은 모니터링용,          ops 실행 상태·커버리지·게시 로그        ▲
    ev03 트리거 아님)            └──────────────────────────────┘       │
 ev02_registration_monthly ──Asset: ev_reg_snapshot (extra: base_month, load_id) ──┤ AssetOrTimeSchedule
 ev10_master_refresh       ──Asset: ev_master_version (활성화 후에만) ─────────────┤ + daily cron
                                                                                   │
 ev11_reprocess ─┬─ registration: TriggerDagRun ▶ ev02 ──(Asset)──────────────────┤
                 ├─ timeband:     재집계 ▶ TriggerDagRun ▶ ev03 (conf) ─────────────┤
                 └─ mart:         TriggerDagRun ▶ ev03 (conf) ───────────────────────┘
 ev12_quality_monitor ──read──▶ Airflow 메타DB(실행 상태) + ops.*(데이터 상태) ──▶ Slack
```

### 3.1 결합 방식 결정

| 관계 | 채택 | 근거 |
|---|---|---|
| ev01 → ev03 | **DB 상태 조회** | 10분마다 마트를 재계산하면 안 된다. ev03는 마지막 정상 수집 시각과 커버리지를 조회한다 |
| ev02 → ev03 | **Asset 트리거** | 월 1회 신규 스냅샷을 지체 없이 반영한다. 이벤트 `extra`는 대상 월의 힌트로만 쓴다(§4.3) |
| ev10 → ev03 | **Asset 트리거** | 검증이 끝난 마스터 버전의 활성화는 재계산 사유다 |
| ev03 자체 | **daily cron** (Asset과 OR) | 지각 데이터, 워터마크 도달, 보류 해소를 주기적으로 재평가한다 |
| ev11 → ev02/ev03 | **범위별 단일 경로** | 같은 기준월에 Asset 트리거와 명시 트리거가 겹치지 않게 한다(§4.5) |

### 3.2 검토 후 기각한 대안

| 대안 | 기각 사유 |
|---|---|
| `ExternalTaskSensor`로 ev03가 ev01·ev02 완료를 대기 | 10분 주기와 월 주기 사이의 `execution_delta` 정렬이 사실상 불가능하다. RFP의 "신규 실행을 기다리지 않는다" 원칙과도 충돌한다 |
| 단일 DAG에서 수집부터 마트까지 일괄 처리 | 월 1회 소스의 실패가 10분 수집을 막고, 재처리 범위가 DAG 전체로 커진다 |
| ev01 Asset으로 ev03 트리거 | 하루 144회 마트 재계산을 시도하게 되고, 실행 이력이 무의미한 skip으로 오염된다 |
| 링크마다 Task 생성 | 링크 수만큼 Task가 폭증한다. Dynamic Task Mapping으로 **묶음 단위**를 가변 생성한다 |
| Asset 이벤트 `extra`를 ev03 `params`처럼 사용 | `extra`는 `params`나 `dag_run.conf`로 자동 전달되지 않는다. 여러 이벤트가 한 실행으로 병합될 수도 있다 `[소스 확인: AssetDagRunQueue PK=(asset_id, target_dag_id)]` |

---

## 4. DAG 상세

### 4.1 `ev01_traffic_collect` — 도로소통정보 수집

**파티션 키**는 `poll_batch_id`(논리적 수집 회차)이고, 집계 키는 `link_id × 날짜 × 시간대`다.

```
init_poll_batch ─▶ check_run_freshness (@task.branch)
      ├─▶ skip_stale_run ────────────────────────────────────────────────┐
      └─▶ get_target_links ─▶ plan_link_chunks                          │
            ─▶ extract_chunk.expand(chunk)     ◀ pool=seoul_openapi_pool│
            ─▶ validate_responses   [all_done_min_one_success]          │
            ─▶ quarantine_invalid ─▶ load_obs ─▶ aggregate_timeband     │
            ─▶ record_coverage                 ◀ outlet: ev_traffic_obs │
                                                                        ▼
                                          finalize_run_status  [all_done]
```

| Task | 역할 | 입력 → 출력 | trigger_rule | 실패 시 |
|---|---|---|---|---|
| `init_poll_batch` | `run_id`에서 결정적으로 파생한 `poll_batch_id` 생성 | — → XCom | all_success | 재시도 |
| `check_run_freshness` | 실행 지연 확인: `now - run_after > 허용 지연`이면 stale 분기 | — → 분기 | all_success | — |
| `skip_stale_run` | 지연 회차를 수집하지 않음 | — | all_success | — |
| `get_target_links` | 대상 링크 목록과 활성 링크 마스터 버전 조회 (사전 제외 링크는 사유와 함께 제외) | core → XCom | all_success | 재시도 |
| `plan_link_chunks` | 링크를 N개 묶음으로 분할하고 **계획된 묶음 목록을 `ops`에 기록** `[미확정: N]` | → ops 묶음 계획 + chunk 리스트 | all_success | 재시도 |
| `extract_chunk` (mapped) | 묶음 순회 호출, 원천 응답과 링크별 호출 상태를 staging에 저장, 묶음 완료 시 `ops` 묶음 상태를 `done`으로 갱신 | API → staging | all_success | 묶음 단위 재시도(지수 백오프). 링크 단위 오류는 **행으로 기록하고 Task는 실패시키지 않음**. 인증·쿼터·묶음 전체 실패만 Task 실패 |
| `validate_responses` | **staging과 `ops` 묶음 상태만 기준으로** 검증한다. mapped Task의 XCom 존재를 가정하지 않는다 | staging → 판정 | **all_done_min_one_success** | 재시도 |
| `quarantine_invalid` | 스키마 불일치·오염 레코드 격리 | staging → quarantine | all_success | 재시도 |
| `load_obs` | 유효 관측 멱등 적재 | staging → core 관측 이력 | all_success | 재시도 → 핵심 실패 |
| `aggregate_timeband` | 이번 회차가 영향을 준 시간대만 링크 시간대 대표값 재계산 | core → core 집계 (UPSERT) | all_success | 재시도 → 핵심 실패 |
| `record_coverage` | 계획 묶음 대비 완료 묶음, 링크별 상태(성공/API 장애/유효 무관측/대상 제외) 기록 | → ops | all_success | 재시도 → 핵심 실패 |
| `finalize_run_status` | 아래 표에 따라 `ops` 실행 상태를 확정하고, 핵심 실패면 예외를 발생시켜 DAG 실행을 실패로 만든다 | ops + upstream 상태 → ops | **all_done** | — |

#### 4.1.1 실행 제어 — 동시 실행 방지와 실행 누적 방지는 별개 정책이다

| 정책 | 수단 | 막는 것 | 막지 못하는 것 |
|---|---|---|---|
| **동시 실행 방지** | `max_active_runs=1` | 같은 DAG의 두 회차가 동시에 같은 링크를 호출·적재하는 것 | 아래의 실행 지연 |
| **예약 회차 누적 방지** | `catchup=False` + `max_active_runs=1` (스케줄러 동작) | 밀린 예약 회차가 줄줄이 생성되는 것 | 수동 트리거 회차의 대기, 실행 시작 후의 pool 대기 |
| **지연 회차 폐기** | `check_run_freshness` (`now - run_after` > 허용 지연이면 `skipped_stale`) `[미확정: 허용 지연]` | 큐에서 오래 대기한 회차가 뒤늦게 수집해 관측 시점의 의미가 흐려지는 것 | — |
| **실행 시간 상한** | `dagrun_timeout` ≈ 폴링 주기 × k `[미확정]` | 한 회차가 장시간 점유하는 것 | — |

- **Airflow 3.3.2의 실제 동작** `[소스 확인]`
  - 활성 실행이 `max_active_runs`에 도달하면 스케줄러는 새 예약 실행을 **생성하지 않는다** (`DagModel.exceeds_max_non_backfill`).
  - 활성 실행이 끝난 뒤 `catchup=False`이면 다음 실행은 놓친 틱이 아니라 **현재 시각 직전 틱**으로 잡힌다 (`CronTriggerTimetable.next_dagrun_info`가 `_align_to_prev(now)`를 후보로 사용).
  - 따라서 정기 실행에서 오래된 회차가 순차적으로 처리되지는 않는다. 대신 **틱이 건너뛰어진다**.
- **건너뛴 틱이 커버리지에 미치는 영향**
  - 커버리지 분모는 폴링 회차가 아니라 사전에 고정한 **링크 × 시간대(1시간)** 조합이다. 따라서 한 시간대 안에서 일부 회차가 빠지는 것은 대표 관측 허용 범위 안에서 흡수된다.
  - 반대로, 한 시간대의 모든 회차가 빠지면 그 링크-시간대는 분자에서 제외된다. 이 경우 회차 단위의 `skipped_stale`·`failed`와 연결해 사유를 남긴다.
- **폴링 주기 확정 기준**: 실측한 회차 실행 시간(p95)이 주기보다 충분히 짧아야 한다. 즉 `링크 수 / 묶음 크기 × 묶음 응답 시간 / pool slots < 주기 × 안전계수`를 만족하도록 주기·묶음 크기·slots를 함께 정한다. `[미확정]`

#### 4.1.2 실패 유형과 최종 상태

| 상황 | 분류 | `ops` 상태 | DAG 실행 |
|---|---|---|---|
| 지연 회차 | — | `skipped_stale` | 성공 |
| 모든 묶음 성공, 핵심 단계 성공 | 정상 | `success` | 성공 |
| 일부 묶음 실패, 핵심 단계 성공 | **허용된 부분 실패** | `partial` (실패 묶음·링크는 분모 포함·분자 제외) | 성공 (실패 묶음 Task의 콜백으로 알림) |
| 완료 묶음 비율 < 최소 기준 `[미확정]` | 허용된 부분 실패 + 경보 | `partial` + 경보 플래그 | 성공 + 경보 |
| 모든 묶음 실패 (`validate_responses`가 upstream_failed) | **핵심 처리 실패** | `failed` | **실패** |
| `load_obs`·`aggregate_timeband`·`record_coverage` 재시도 소진 | **핵심 처리 실패** | `failed` | **실패** |

- `finalize_run_status`는 `ops` 상태를 **먼저 기록한 뒤** 예외를 발생시킨다. 기록은 `run_id` 키 UPSERT로 하므로 재시도해도 안전하다.
- **실시간 데이터의 재시도 한계**: 지난 시점을 재호출해도 그 시점 값은 돌아오지 않는다. 재시도는 대표 관측 허용 시간 범위 안에서만 의미가 있고, 범위 밖의 실패는 "재처리 대상"이 아니라 "결측"으로 확정한다.
- **멱등성**: `poll_batch_id = f(run_id)`이므로 Task 재시도나 Clear 후에도 같은 ID가 유지된다. 적재는 `ON CONFLICT (link_id, poll_batch_id) DO NOTHING`이다.
- **집계 시점**: 진행 중인 시간대는 매 회차 UPSERT로 갱신하고 시간대가 끝나면 확정한다. 대표 관측은 목표 시각과 가장 가까운 유효 관측으로 정하고, 동률이면 사전 타이브레이커를 적용한다. `[미확정: 목표 시각·허용 범위]`

---

### 4.2 `ev02_registration_monthly` — 등록현황 월 배치

**파티션 키**는 `base_month`(등록 기준월)다. 기준월은 실행 시각에서 암묵적으로 유도하지 않고 **명시적으로 결정**한다.

```
resolve_base_month
  ─▶ wait_base_month_published  (sensor · mode=reschedule · soft_fail=True)
  ─▶ choose_source (@task.branch: Variable ev_reg_source_mode = api | csv)
        ├─▶ extract_reg_api
        └─▶ extract_reg_csv
  ─▶ validate_base_month   [none_failed_min_one_success]
  ─▶ reconcile_totals ─▶ normalize_admdong_fuel ─▶ quarantine_unmapped ─▶ snapshot_gate
  ─▶ compare_with_existing (@task.branch)
        ├─▶ skip_identical
        └─▶ load_snapshot           ◀ outlet: ev_reg_snapshot (extra={base_month, load_id, request_id})
  ─▶ record_run  [all_done]
```

#### 4.2.1 기준월 결정과 센서 조건

| 실행 유형 | `base_month` 결정 | 센서 조건 | 센서 미충족 시 |
|---|---|---|---|
| **정기 실행** (cron) | `logical_date`(KST)의 월 − `공표 지연 개월` `[미확정: 1개월로 가정]` | 원천에 **이 `base_month`가 공표됐는가** | 대기(reschedule) → `timeout` `[미확정]` 초과 시 soft_fail(skip) → `record_run`이 `publication_delayed`로 기록하고 알림 |
| **특정 월 재처리** (`params.base_month`) | `params.base_month` 우선 | 같은 조건. 이미 공표된 월이면 즉시 통과 | 원천에 해당 월이 없으면 즉시 실패(요청 오류) |
| **이미 적재한 월의 재공표** | 정기 또는 재처리와 같음 | 같은 조건 | — |

- v0.1의 "원천 최신 기준월 > 마지막 적재 기준월" 조건은 폐기했다.
  - 그 조건으로는 같은 월을 재적재할 때 센서가 영원히 대기한다.
  - 또 센서가 감지한 월과 실행이 기대하는 월이 어긋날 수 있다.
  - 새 조건은 **"대상 월이 공표됐는가"** 하나로 정기 실행과 재처리를 함께 처리한다.
- `CronDataIntervalTimetable`의 `data_interval_start`에 의존하던 방식도 폐기했다. 대신 `resolve_base_month`가 위 규칙으로 계산해 XCom과 `ops`에 남긴다. 규칙이 코드 한 곳에 있으므로 단위 테스트가 가능하다.
- 기준월 누락 감지(예: 직전 월이 적재되지 않은 채 다음 월이 적재됨)는 ev12가 보고하고, 보완은 ev11로 한다.

#### 4.2.2 재공표 처리 (`compare_with_existing`)

| 비교 결과 | 처리 | `ops` 상태 | Asset 이벤트 |
|---|---|---|---|
| 해당 월 스냅샷 없음 | 신규 적재, `load_id` 발급 | `success` | 발생 |
| 있음, 내용 해시 동일 | 적재 생략 | `unchanged` | **발생하지 않음** → ev03 불필요 실행 방지 |
| 있음, 내용 상이 | 기존 `load_id`와 새 `load_id`의 차이(행 수·합계·변경 행정동)를 기록한 뒤 파티션 교체 | `republished` | 발생 |

- `load_snapshot`은 `base_month` 파티션을 **단일 트랜잭션 안에서 delete + insert**로 교체한다.
- `record_run`(`all_done`)은 upstream 상태를 조회해 상태를 확정한다. 가능한 상태는 `success`·`republished`·`unchanged`·`publication_delayed`·`failed`이며, `failed`일 때는 예외를 발생시킨다.
- **백필**: `catchup=False`로 자동 소급을 막는다. 소급이 필요하면 ev11(`scope=registration`, 월 목록)을 사용한다. `airflow backfill create`는 `logical_date` 기반이라 기준월 규칙을 거치므로 쓸 수는 있지만, 사유가 기록되도록 ev11 경로를 표준으로 한다.

---

### 4.3 `ev03_mart_integration` — 통합 마트

**파티션 키**는 `base_month`이고, 도로 분석 기간은 같은 월의 완료 기간이다. **1회 실행에서 기준월 1개를 처리한다.**

```
resolve_target_period (@task.branch)
  ├─▶ no_eligible_period ───────────────────────────────────────────────┐
  └─▶ [TaskGroup gate1_run_eligibility]   ◀ 병렬                         │
        check_reg_snapshot · check_traffic_freshness · check_coverage     │
        · check_master_version · check_min_timebands                      │
      ─▶ evaluate_gate1 (@task.branch)                                    │
            ├─▶ hold_publish ─▶ mark_stale_and_alert ───────────────────┤
            ├─▶ skip_unchanged ─────────────────────────────────────────┤
            └─▶ spatial_join ─▶ admdong_timeband_agg ─▶ compute_indicators
                 ─▶ region_quality_gate (Gate 2) ─▶ classify_abc         │
                 ─▶ build_mart_candidate ─▶ verify_candidate              │
                 ─▶ publish_mart        ◀ outlet: ev_mart_published      │
                                                                         ▼
                                              record_run_result  [all_done]
```

#### 4.3.1 대상 기준월 결정 (`resolve_target_period`)

후보는 **dirty 월**, 즉 "현재 입력 fingerprint ≠ 마지막으로 *평가한* fingerprint"인 기준월이다. 여기서 평가에는 게시와 보류가 모두 포함된다.

| 우선순위 | 출처 | 처리 |
|---|---|---|
| 1 | `dag_run.conf.base_month` (ev11·수동) | 그 월을 대상으로 한다. `conf.force=True`이면 fingerprint 비교를 생략한다 |
| 2 | `triggering_asset_events`의 `extra.base_month` | **힌트로만** 사용한다. DB에서 그 월이 여전히 dirty인지 확인한 뒤 채택한다. 이벤트가 여러 개면 dirty인 월 중 최신 월을 고른다 |
| 3 | DB의 dirty 월 목록 | 최신 월을 우선한다. 나머지는 다음 실행에서 처리하고, 남은 건수를 `ops`에 기록한다 |
| — | 후보 없음 | `no_eligible_period`로 기록한다 (대상 기간 미완료, 스냅샷 없음 등 **입력 대기 상태**) |

- **fingerprint 구성**: `hash(스냅샷 load_id, 분석 기간 링크 시간대 집계의 최종 갱신 워터마크, 활성 링크 마스터 버전, 활성 경계 버전, 활성 임계값 버전)`
- **자동 재계산 범위**
  - 데이터 입력(스냅샷·도로 집계)이 바뀐 월은 모든 월이 대상이다.
  - 버전(마스터·임계값)만 바뀐 경우에는 **최신 적격 월만** 자동으로 재계산한다.
  - 과거 월의 버전 변경 재계산은 ev11 명시 요청으로만 한다. 이는 RFP §07의 "마스터 버전 변경 시에는 명시적으로 재실행" 원칙을 따른 것이다.
- **보류된 월이 무한 재평가되지 않는 이유**: 보류도 평가된 fingerprint를 기록한다. 따라서 보류된 월은 지각 데이터 도착 등으로 입력이 바뀔 때만 다시 후보가 된다.
- **`skip_unchanged`는 fingerprint 비교를 실제로 수행했을 때만** 선택된다. 입력이 준비되지 않은 상태(`no_eligible_period`)와 구분하기 위해서다.

#### 4.3.2 Task

| Task | 역할 | 실패·분기 처리 |
|---|---|---|
| `check_reg_snapshot` | ⒜ 해당 월 스냅샷 존재 여부와 품질 등급 | 결과는 XCom으로 넘기고 Task는 실패시키지 않는다 |
| `check_traffic_freshness` | ⒝ 마지막 정상 수집 시각. **수집 최신성**만 보장하고 원천 최신성은 별도 플래그로 둔다 | 〃 |
| `check_coverage` | ⒞ 링크-시간 커버리지 (분모는 사전에 고정) | 〃 |
| `check_master_version` | ⒟ 링크 마스터와 행정동 경계가 **활성(검증 완료) 버전**인지, 서로 정합하는지 | 〃 |
| `check_min_timebands` | ⒠ 지표 산출에 필요한 최소 시간대 수 | 〃 |
| `evaluate_gate1` | 다섯 결과와 fingerprint를 종합한다 | `hold` / `skip_unchanged` / `proceed` 3분기 |
| `hold_publish` → `mark_stale_and_alert` | 이전 정상 결과를 유지하고, 게시 상태를 `stale`로 표시한 뒤 알린다 | — |
| `spatial_join` | (링크 버전, 경계 버전)의 매핑이 있으면 재사용하고, 없으면 중점 귀속으로 계산한다 | Clear 재실행 |
| `admdong_timeband_agg` | 행정동 × 시간대 평균 속도 (도로 길이 가중을 기본으로 하고 단순 평균을 병행) | 〃 |
| `compute_indicators` | 판정 지표와 보조 지표 산출 | 〃 |
| `region_quality_gate` | **Gate 2**: 대상 행정동 전체에 품질 등급을 부여한다 | 〃 |
| `classify_abc` | 판정 순서 C → A → B → 참고군. 원천 갱신이 미검증이면 B를 비활성화하고 `b_suppressed` 플래그를 기록한다 | 〃 |
| `build_mart_candidate` | 후보 테이블 생성. 운영 마트는 건드리지 않는다 | 〃 |
| `verify_candidate` | §4.3.3의 완전성 조건 검사 | 실패 시 게시하지 않고 운영 마트를 그대로 유지한다 |
| `publish_mart` | §4.3.3 게시 트랜잭션 | 롤백 시 운영 마트 유지 |
| `record_run_result` | upstream 상태와 게시 로그를 조회해 실행 결과를 확정한다 (§4.3.4) | — |

#### 4.3.3 지역별 결과 상태와 게시 범위

**후보 마트는 분석 대상 행정동 전체를 한 행씩 빠짐없이 포함한다.** 판정할 수 없는 지역도 행을 빼지 않고 상태로 표현한다.

| `classification` | 의미 | 근거 (RFP §03) |
|---|---|---|
| `A` / `B` / `REF` | 정상 판정 (규모·추세 우위 / 환경 변동 큼 / 참고군) | 품질 등급 정상 또는 경고 |
| `C` | 유효한 결과지만 기준 미달 → 데이터 보완 대상 | 품질 등급 기준 미달 |
| `WITHHELD` | 결과를 신뢰할 수 없어 분류를 보류하고 결과를 제공하지 않음 | 품질 등급 치명 |

- `verify_candidate`의 통과 조건:
  - 후보 행 수 = 활성 경계 버전의 대상 행정동 수
  - (행정동, `base_month`) 키 중복 없음
  - `classification` null 없음
  - 분류 분포의 급변이 경보 기준 이내 `[미확정]`
- **게시 트랜잭션** (`publish_mart`, 단일 트랜잭션):
  1. 운영 마트에서 해당 `base_month` 행을 **전부 삭제한 뒤 후보 전체를 삽입**한다(파티션 교체). UPSERT만 하면 후보에 없는 지역의 이전 결과가 남기 때문에 쓰지 않는다.
  2. 같은 트랜잭션 안에서 `ops` 게시 로그(`base_month`, `run_id`, fingerprint, 입력 `load_id`, 마스터·경계·임계값 버전, `published_at`)와 게시 상태(`current`)를 기록한다.
  - 그 결과 **게시와 계보가 원자적**이 된다. "게시는 됐는데 계보가 없는" 상태가 생기지 않는다.
- **게시 상태** (`base_month` 단위):

| 상태 | 의미 |
|---|---|
| `current` | 최신 입력으로 게시된 결과 |
| `stale` | Gate 1 보류로 이전 결과를 유지 중. 최신 아님을 사유와 함께 표시 |
| `never_published` | 아직 게시된 결과가 없음 |

  사용자 조회 뷰는 마트와 게시 상태를 조인해 기준월, 도로 분석 기간, 마지막 정상 게시 시각, 현재 상태를 함께 노출한다(RFP §09).

#### 4.3.4 실행 결과 확정 (`record_run_result`)

| 경로 | `ops` 실행 상태 | DAG 실행 |
|---|---|---|
| `no_eligible_period` | `no_eligible_period` (입력 대기, 대기 사유 포함) | 성공 |
| `skip_unchanged` | `skipped_unchanged` | 성공 |
| `hold_publish` | `held` (보류 사유 = Gate 1 실패 항목) | 성공 |
| `publish_mart` 성공 | `published` | 성공 |
| 처리 Task 또는 `verify_candidate` 실패 | `failed` (실패 Task, 운영 마트 미변경) | **실패** |

- 트리거 규칙은 **`all_done`**이다. 보류·실패·무변경 경로에서도 반드시 실행된다.
- 실행 상태 기록은 `run_id` 키 UPSERT로 하므로 이 Task만 재시도해도 안전하다.
- 게시 여부의 진실 원천은 §4.3.3의 게시 로그다. 실행 상태 기록이 실패해도 게시 사실은 이미 남아 있으므로, DAG를 다시 실행해 `skipped_unchanged`가 선택되더라도 계보는 손실되지 않는다.

---

### 4.4 `ev10_master_refresh` — 마스터 갱신 (확장)

```
detect_source_files ─▶ load_master_staging ─▶ register_version (status=pending)
  ─▶ validate_geometry ─▶ build_link_admdong_map ─▶ validate_mapping_quality
  ─▶ activate_version (status=active)   ◀ outlet: ev_master_version
  ─▶ record_run [all_done]
```

- **등록 시점과 활성 시점을 분리한다.** 새 버전은 `pending`으로 등록되고, 기하 검증(SRID, `ST_IsValid`, 경계 중복·틈, A↔C 링크ID 조인율)과 매핑 품질 검증(매핑 성공률, 미귀속 비율)을 통과해야만 `active`가 된다.
- ev01·ev03는 `active` 버전만 사용한다. 검증에 실패한 버전은 `rejected`로 남고 Asset 이벤트도 발생하지 않는다.
- 버전은 추가만 하고 덮어쓰지 않는다. 그래서 과거 마트를 재현할 수 있다.

### 4.5 `ev11_reprocess` — 재처리 단일 진입점 (확장)

`params`는 JSON Schema로 검증한다. 필드는 `scope` ∈ {`registration`, `timeband`, `mart`}, `base_months`(목록), `date_from`/`date_to`(timeband), `force`(mart, 기본 False), `reason`(필수)이다.

```
validate_request ─▶ register_request (ops, request_id 발급) ─▶ route_scope (@task.branch)
  ├─ registration ─▶ trigger_ev02.expand(base_month)   (conf={base_month, request_id}, wait_for_completion)
  │                   └ ev03는 ev02의 Asset 이벤트로 실행된다 — 여기서 ev03를 직접 트리거하지 않는다
  ├─ timeband ─────▶ reaggregate_timeband ─▶ trigger_ev03.expand(base_month)  (conf={base_month, request_id}, wait)
  └─ mart ─────────▶ trigger_ev03_mart.expand(base_month) (conf={base_month, force, request_id}, wait)
─▶ record_request_result  [all_done]
```

| 범위 | 재처리 작업 | 통합 DAG 실행 | 결과 기록 |
|---|---|---|---|
| `registration` | ev02 재실행 (월별) | **ev02의 Asset 이벤트 → ev03** (명시 트리거 없음). ev02가 `unchanged`이면 ev03도 실행되지 않는다 | ev02 결과를 기록. ev03 결과는 이벤트 `extra.request_id`를 통해 ev03 게시 로그에 연결된다 |
| `timeband` | 지정 기간의 링크 시간대 재집계 | **ev03 명시 트리거** (`conf.base_month`). 집계 워터마크가 바뀌므로 `force`는 불필요하다 | ev03 실행 결과를 기록 |
| `mart` | 없음 (임계값·마스터 버전 변경, 로직 수정) | **ev03 명시 트리거** (`conf.base_month`, 필요 시 `force`) | ev03 실행 결과를 기록 |

- 여러 월은 mapped `TriggerDagRunOperator`로 요청하고, ev03의 `max_active_runs=1`이 실행을 직렬화한다. 수동 트리거 회차는 대기열에 들어가 순서대로 실행된다.
- 경로를 위와 같이 하나로 정해도 예상하지 못한 중복 실행(예: 재처리와 정기 cron이 겹침)은 생길 수 있다. 이때 두 번째 실행은 fingerprint가 같으므로 `skipped_unchanged`로 끝난다. 이것이 **안전망**이다.

### 4.6 `ev12_quality_monitor` / `ev13_retention_cleanup` (확장)

**ev12**는 두 원천을 교차 확인한다.

| 확인 대상 | 출처 |
|---|---|
| 실행 상태 (성공/실패/미수행/수행 중) | Airflow 메타DB (강의 `dags_daily_dag_monitoring` 패턴) |
| 데이터 상태 (`partial`, `held`, `stale`, `publication_delayed`, `no_eligible_period` 장기 지속, 기준월 누락, 커버리지 추이, 수집 최신성) | `ops` |
| **불일치** (DAG는 성공인데 데이터는 `partial`·`held`) | 두 원천의 조인 — 리포트의 핵심 섹션 |

**ev13**은 보존 기간이 지났다는 이유만으로 삭제하지 않는다. 아래 조건을 **모두** 만족하는 데이터만 정리한다.

| 대상 | 삭제 조건 |
|---|---|
| 원천 관측 이력 | 보존 기간 경과 `[미확정]` **그리고** 해당 시간대 집계가 확정됨 **그리고** 해당 월이 게시(`current`)됨 **그리고** 그 기간을 대상으로 열린 ev11 요청이 없음 |
| staging | 해당 run의 `ops` 상태가 최종 확정됨 **그리고** 보존 기간 경과 |
| quarantine | 보존 기간 경과 **그리고** 사유 집계가 `ops`에 기록됨 |
| 집계, 스냅샷, 게시 로그, 마스터 버전 | **삭제하지 않음** (계보·재현의 근거) |

---

## 5. 품질 게이트

| 게이트 | 위치 | 단위 | 판정 | 결과 |
|---|---|---|---|---|
| Gate 0 · 수집 완결성 | ev01 `record_coverage`, ev02 `snapshot_gate` | 수집 회차 / 기준월 | 완료 묶음 비율, 총건수 대조 | `success` / `partial` / 치명이면 적재 차단 |
| Gate 1 · 전체 실행 적격성 | ev03 `evaluate_gate1` | 기준월 | 기준월, 스키마, 활성 마스터, 분석 기간 | 미달이면 **게시 보류**(`held`) + 이전 결과 `stale` 표시 |
| Gate 2 · 지역별 품질 | ev03 `region_quality_gate` | 행정동 | 커버리지, 매핑, 관측량, 등록 품질 | 아래 표 |

| 등급 | 조건 예 | 처리 |
|---|---|---|
| 치명 | 기준 기간 식별 불가, 필수 데이터 무효 | `WITHHELD` (행은 유지하고 결과는 제공하지 않음) |
| 기준 미달 | 커버리지·매핑·관측 품질 미달 | `C` |
| 경고 | 선택 필드 누락 | 영향받는 지표만 제한하고 경고 기록 |
| 정상 | — | `A` / `B` / `REF` 판정 |

일부 행정동이 미귀속이면 해당 지역만 C 또는 `WITHHELD`로 처리하고, 다른 적격 지역의 갱신은 막지 않는다. 반대로 모든 행정동이 매핑 불가이면 Gate 1에서 전체를 보류한다.

---

## 6. 멱등성과 재실행 일관성

| 데이터 | 멱등 키 | 적재 방식 |
|---|---|---|
| staging 원천 | `run_id` (+ 묶음 번호) | run 단위 delete + insert |
| ops 묶음 계획·상태 | `(poll_batch_id, chunk_no)` | UPSERT |
| 도로 관측 이력 | `(link_id, poll_batch_id)` | `ON CONFLICT DO NOTHING` |
| 링크 시간대 집계 | `(link_id, 날짜, 시간대)` | UPSERT (영향 시간대만 재계산) |
| 등록 스냅샷 | `base_month` 파티션 | 내용 해시 비교 후 트랜잭션 안에서 delete + insert, `load_id` 발급 |
| 링크-행정동 매핑 | `(link_master_ver, boundary_ver)` | 버전별 추가 전용 |
| 분석 마트 | `base_month` 파티션 | 후보 검증 후 **파티션 전체 교체** + 게시 로그를 단일 트랜잭션으로 |
| ops 실행 상태 | `(dag_id, run_id)` | UPSERT |

`ON CONFLICT DO NOTHING`은 같은 배치 안에서 나중에 도착한 수정값을 무시한다. 따라서 원천이 배치 안에서 불변이라는 전제를 실증으로 확인한다. 정정이 필요하면 ev11 재처리로 처리한다(RFP §07).

---

## 7. 재처리 설계

| 상황 | 재처리 단위 | 경로 |
|---|---|---|
| ev01 묶음 API 일시 실패 | 해당 mapped index | 자동 재시도(백오프). 재시도를 소진하면 `partial`로 기록하고 진행 |
| ev01 적재·집계 실패 | 실패 Task부터 | UI에서 Clear(downstream 포함). staging이 run_id로 보존되므로 API 재호출이 필요 없다 |
| ev02 공표 지연 | `base_month` | 센서 soft_fail → `publication_delayed` 알림 → 공표 후 ev11 `registration` |
| ev02 원천 재공표·정정 | `base_month` | ev11 `registration` → ev02 → (내용 변경 시) Asset → ev03 |
| 지각 도로 데이터 | 날짜 범위 | ev11 `timeband` → 재집계 → ev03 명시 트리거 |
| 마스터 버전 변경 | 최신 월은 자동, 과거 월은 요청 | ev10 활성화 → Asset → ev03(최신 월). 과거 월은 ev11 `mart` |
| 분류 임계값 변경 | 지정 기준월 | 임계값 신규 버전 등록 → ev11 `mart` |
| ev03 처리·검증 실패 | 해당 run | 운영 마트는 변경되지 않음 → 실패 Task부터 Clear |
| ev03 게시 후 결과 기록만 실패 | `record_run_result` | 그 Task만 재시도. 게시 로그가 이미 있으므로 계보 손실은 없다 |
| ev03 Gate 1 보류 | 해당 기준월 | 원인이 해소되면 입력 fingerprint가 바뀌어 dirty가 되고, 다음 정기 실행이 자동으로 재평가한다 |

---

## 8. 상태 모델 (`ops`)

**실행 상태** (`dag_id`, `run_id` 단위)

| 상태 | 의미 | 발생 DAG |
|---|---|---|
| `success` | 실행·완결성·적격성 모두 통과 | ev01, ev02, ev10 |
| `partial` | 허용된 부분 수집 실패 (성공분은 적재) | ev01 |
| `skipped_stale` | 지연 회차로 수집하지 않음 | ev01 |
| `unchanged` | 재공표 내용이 동일해 적재 생략 | ev02 |
| `republished` | 같은 월을 다른 내용으로 재적재 | ev02 |
| `publication_delayed` | 공표 대기 시간 초과 | ev02 |
| `no_eligible_period` | 처리할 기준월 없음 (입력 대기) | ev03 |
| `skipped_unchanged` | fingerprint 비교 결과 변경 없음 | ev03 |
| `held` | Gate 1 미달로 게시 보류 | ev03 |
| `published` | 게시 완료 | ev03 |
| `failed` | 핵심 처리 실패 | 전체 |

이와 별도로 **게시 상태**(`base_month` 단위: `current`, `stale`, `never_published`)와 **재처리 요청 상태**(`request_id` 단위)를 둔다.

---

## 9. 시간 기준 정리

| 개념 | 정의 | 사용처 |
|---|---|---|
| `logical_date` / `run_after` | Airflow 실행 기준 시각 | 실행 식별과 지연 판정(`check_run_freshness`). **데이터 기간으로 쓰지 않는다** |
| `collected_at` | 실제 수집 시각 | ev01 관측 이력, 수집 최신성 |
| `source_observed_at` | 원천 관측 시각 (없으면 NULL) `[미확정: 제공 여부]` | 원천 최신성, B 판정 활성 조건 |
| `base_month` | 등록 기준월. ev02의 `resolve_base_month`가 명시적으로 결정 | ev02·ev03 파티션 |
| 도로 분석 기간 | `base_month`와 같은 월의 완료 기간 (예: 2026-09 → 09-01~09-30) | ev03 지표 |
| 워터마크 | 분석 기간 종료 + 지각 허용 `[미확정]` | dirty 월 판정 |

---

## 10. 운영 리소스

| 종류 | 이름 | 비고 |
|---|---|---|
| Pool | `seoul_openapi_pool` `[미확정: slots]` | ev01과 ev02가 **공유**한다. 인증키가 계정 단위라 호출 제한도 계정 단위이기 때문이다. 경합하면 `priority_weight`로 ev01을 우선한다 |
| Connection | `conn_seoul_openapi` (HTTP), `conn_postgis_ev` (Postgres), `conn_slack_airflow_bot` | Slack 연결은 강의 프로젝트를 재사용 |
| Variable | `apikey_openapi_seoul_go_kr`, `ev_reg_source_mode` | 임계값은 Variable이 아니라 **DB 버전 테이블**에 둔다 (계보 연결) |
| Asset | `ev_traffic_obs`, `ev_reg_snapshot`, `ev_master_version`, `ev_mart_published` | `plugins/common/assets.py`에 한 번만 정의 |

---

## 11. 저장 계층 (잠정 — API 실증 후 확정)

| 스키마 | 역할 | 주요 데이터 |
|---|---|---|
| `staging` | 원천 + run_id·collected_at·base_month | 도로 원천 응답, 등록 원천 |
| `core` | 정제·이력·마스터 | 관측 이력, 링크 시간대 집계, 등록 스냅샷(load_id), 마스터 버전(pending/active/rejected), 링크-행정동 매핑 |
| `mart` | 게시 결과 | `fact_admdong_indicator`(classification에 `WITHHELD` 포함), 행정동 시간대 집계, `dim_admdong`·`dim_base_month`·`dim_timeband`, 마트 후보 테이블 |
| `ops` | 운영·계보 | 실행 상태, 묶음 계획·상태, 커버리지, 품질 결과, 게시 로그·게시 상태, 평가 fingerprint, 재처리 요청, 임계값 버전 |
| `quarantine` | 오염·미매핑 레코드 | 사유 코드와 함께 보존 |

---

## 12. 테스트 계획 — 정책을 문서가 아닌 테스트로 강제

> 현재 상태: **테스트 미구현.** 아래는 구현할 테스트 목록이다. 구현하기 전까지 이 표의 정책은 "설계"이며, CI에서 "강제"된다고 표현하지 않는다.

| 층위 | 테스트 | 검사 내용 |
|---|---|---|
| 정적 (DagBag) | import 오류 | DagBag `import_errors` 없음 (RFP §08 validate_dag) |
| 정적 | 공통 정책 | 모든 DAG `catchup=False`, `tags`, `retries ≥ 1` |
| 정적 | `max_active_runs` | DAG별 기대값 표(§2)와 일치 |
| 정적 | Pool | 외부 API 호출 Task(ev01 `extract_chunk`, ev02 `extract_reg_api`)에 `seoul_openapi_pool` 지정 |
| 정적 | Sensor 모드 | 모든 Sensor `mode='reschedule'` |
| 정적 | trigger_rule 명세 | 기대값 표와 일치. 예: ev01 `validate_responses=all_done_min_one_success`, `finalize_run_status=all_done`; ev02 `validate_base_month=none_failed_min_one_success`, `record_run=all_done`; ev03 `record_run_result=all_done`; ev11 `record_request_result=all_done` |
| 정적 | outlet 위치 | outlet은 지정된 Task(§2)에만 있고, 그 Task의 upstream에 검증·게이트 Task(ev03 `verify_candidate`, ev02 `snapshot_gate`, ev10 `validate_mapping_quality`)가 있다 |
| 정적 | 최종 상태 Task | 각 핵심 DAG의 유일한 leaf가 `all_done` 상태 확정 Task다 |
| 단위 | 기준월 결정 | `resolve_base_month`: 정기 실행, `params` 우선, KST 월 경계 |
| 단위 | 지연 회차 판정 | `check_run_freshness`의 경계값 |
| 단위 | 대상 월 선택 | `resolve_target_period`: conf > 이벤트 힌트(dirty 검증) > dirty 최신, 후보 없음 → `no_eligible_period` |
| 단위 | 최종 상태 매핑 | §4.1.2, §4.3.4 표의 각 행 |
| 통합 (DB) | 게시 원자성 | `verify_candidate` 실패 또는 게시 트랜잭션 중 예외 → 운영 마트와 게시 로그 **변경 없음** |
| 통합 (DB) | 파티션 교체 | 이전 게시에 있던 지역이 후보에서 `WITHHELD`가 되면 운영 마트도 `WITHHELD`로 바뀐다 (이전 분류가 남지 않음) |
| 통합 (DB) | 멱등 적재 | 같은 `poll_batch_id`·`base_month`를 재적재해도 행 수 불변 |
| 통합 (Airflow) | 분기 합류 | `dag.test()`로 각 분기 경로에서 최종 Task가 실행되고 기대한 상태를 기록하는지 |

외부 API를 호출하지 않는 fixture 테스트와 실제 API 통합 테스트는 분리한다(RFP §08).

---

## 13. 미확정 항목 (실증 후 확정)

| 항목 | 확정 방법 | 영향 범위 |
|---|---|---|
| 폴링 주기, 묶음 크기 N, pool slots | 링크 수 × 묶음 응답 시간 실측(p95), 호출 제한 | ev01 스케줄, 병렬도 |
| 지연 회차 허용 지연, `dagrun_timeout` | 폴링 주기 확정 후 | `check_run_freshness` |
| 완료 묶음 최소 비율 (경보 기준) | 응답 실패율 분포 | ev01 최종 상태 |
| `source_observed_at` 제공 여부 | `verify_apis.py` | B 판정 활성화 |
| 등록현황 수집 경로 (API 전수 / CSV) | `list_total_count` vs CSV 합계 | ev02 분기 기본값 |
| 등록현황 공표 지연 개월, 공표 일자 | 원천 확인과 수개월 관측 | `resolve_base_month`, 센서 timeout |
| 대표 관측 목표 시각·허용 범위 | 폴링 주기 확정 후 | ev01 집계, 커버리지 |
| 지각 허용 (워터마크) | 수집 지연 분포 | dirty 월 판정 |
| 분류 임계값, 분포 급변 경보 기준 | 실제 분포(분위수) + 민감도 검토 | `classify_abc`, `verify_candidate` |
| 보존 기간 | 실제 수집량 | ev13 |

---

## 14. Airflow 3.3.2 동작 검증

| 항목 | 상태 | 근거 / 방법 |
|---|---|---|
| `max_active_runs` 도달 시 새 예약 실행 미생성 | `[소스 확인]` | `scheduler_job_runner`: `exceeds_max_non_backfill`이면 생성 생략 |
| `catchup=False`에서 놓친 틱은 건너뛰고 직전 틱으로 실행 | `[소스 확인]` | `timetables/trigger.py`: `_align_to_prev(utcnow())` 후보 |
| `AssetOrTimeSchedule`, `CronTriggerTimetable`, `CronDataIntervalTimetable`의 `airflow.sdk` 제공 | `[소스 확인]` | `airflow/sdk/__init__.py` |
| Asset 이벤트는 Task 성공 시에만 발생 | `[소스 확인]` | `task_runner._handle_current_task_success` |
| 같은 Asset의 여러 이벤트가 한 실행으로 병합 | `[소스 확인]` | `AssetDagRunQueue` PK = (asset_id, target_dag_id) |
| `all_done_min_one_success` 제공, 모든 upstream 실패 시 upstream_failed | `[소스 확인]` | `ti_deps/deps/trigger_rule_dep.py` |
| `triggering_asset_events` 컨텍스트에서 `extra` 조회 | `[파싱 검증 예정]` | 컨텍스트 키 존재는 확인. 실제 `extra` 접근은 `dag.test()`로 확인 |
| `TriggerDagRunOperator` mapped + `wait_for_completion` + deferrable | `[파싱 검증 예정]` | ev11 구현 시 |
| 분기 후 `all_done` 합류 Task의 실행과 DAG 최종 상태 | `[파싱 검증 예정]` | §12 통합 (Airflow) 테스트 |

---

## 15. 변경 이력

### v0.2 (2026-10-27) — v0.1 리뷰 반영

| # | 리뷰 지적 | 판정 | 반영 |
|---|---|---|---|
| ① | `max_active_runs=1`은 실행 누적을 막지 못함 | **부분 타당.** Airflow 3.3.2 소스상 `catchup=False`의 정기 실행은 누적되지 않고 틱을 건너뛴다. 다만 v0.1의 "다음 실행은 대기"라는 표현이 부정확했고, 수동 회차 대기·pool 대기·건너뛴 틱이 커버리지에 주는 영향은 다루지 않았다 | §4.1.1: 정책을 네 가지(동시 실행 방지, 예약 누적 방지, 지연 회차 폐기, 실행 시간 상한)로 분리. `check_run_freshness`와 `dagrun_timeout` 추가, 커버리지 영향 명시 |
| ② | 센서 조건과 `base_month` 불일치 | 타당 | §4.2.1: `resolve_base_month`로 기준월을 명시적으로 결정, 센서는 "대상 월 공표 여부"만 확인, `params` 우선, soft_fail → `publication_delayed`. §4.2.2 재공표 비교 추가 |
| ③ | ev11의 Asset 트리거와 명시 트리거 중복 | 타당 | §4.5: 범위별 단일 경로(registration은 Asset, timeband·mart는 명시 트리거)로 정리하고, 세 분기의 의존성을 명시. fingerprint를 안전망으로 둠 |
| ④ | 부분 실패 DAG의 최종 상태 모호 | 타당 | §4.1.2: 허용된 부분 실패와 핵심 처리 실패를 구분. `finalize_run_status`(all_done) 추가, 검증은 staging과 `ops` 묶음 상태 기준, `all_done_min_one_success` 적용 |
| ⑤ | 치명 오류 지역의 이전 결과 잔존 | 타당 | §4.3.3: 후보에 대상 행정동 전체를 포함하고 `WITHHELD` 상태 추가. 게시는 파티션 교체로, 게시 상태 `current`/`stale`/`never_published` 추가 |
| 4.1 | `skip_unchanged`와 대상 없음 혼동 | 타당 | `no_eligible_period` 분기·상태 분리 |
| 4.2 | Asset `extra` ≠ `params` | 타당 | §4.3.1: 이벤트는 힌트로만 쓰고, DB의 dirty 월 판정으로 대상을 결정 |
| 4.3 | `record_lineage`가 실패 시 미실행 | 타당 | `record_run_result`(all_done)로 변경. 계보는 게시 트랜잭션 안으로 옮겨 원자화. 리뷰 제안보다 강화: 게시 후 기록 실패로 계보가 손실되는 경우 자체를 제거 |
| 5 | CI 정책은 문서일 뿐 | 타당 | §12를 "테스트 계획"으로 바꾸고 미구현임을 명시. outlet 위치, 게시 원자성, 파티션 교체 테스트 추가 |
| 5 | ev10·ev12·ev13 보완 | 타당 | ev10 pending → active 분리, ev12 실행 상태 × 데이터 상태 교차 확인, ev13 조건부 삭제 |
| 6-4 | Airflow 3.3.2 실행 검증 | 타당 | §14: 소스 확인 6건, 파싱 검증 예정 3건 |

추가 변경: ev02 timetable을 `CronDataIntervalTimetable`에서 `CronTriggerTimetable`과 명시적 기준월 결정으로 변경. ev03 대상 선택을 dirty 월 모델로 정의하고, 보류된 월이 무한 재평가되지 않도록 함.

### v0.1 (2026-10-27)
- 최초 초안.
