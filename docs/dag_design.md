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

## 0. MVP 범위 (2026-10-27 결정)

API 실증 결과, RFP 원안대로면 첫 마트 게시가 2027년 1월 이후다. 도로 관측은 실시간이라 과거 이력이 없고, 등록현황은 1~2개월 늦게 공표된다. 제출 일정에 맞춰 아래처럼 범위를 줄인다.

| 항목 | RFP 원안 | MVP |
|---|---|---|
| 도로 분석 기간 | 등록 기준월과 같은 월 | 최신 등록 스냅샷 × 최근 완료 7일 관측. 결과 행에 `period_mismatch=true` 표시 |
| 대상 지역 | 서울 전체 | 강남·서초·송파 (행정동 67개, 서비스링크 936개) |
| 폴링 주기 | 수 분 (설계값) | 1시간. 커버리지 단위(1시간)와 맞추고 호출량을 하루 약 2.2만 회로 제한 |
| 등록 이력 | API 전수 | 최신 월은 API, 증가율용 전년 동월은 파일 1개 수동 적재 |
| 유형 B | 원천 갱신 검증 후 활성 | 비활성 (원천 관측시각 없음). A·C·참고군만 제공 |
| DAG | 7개 | ev01·ev02·ev03 구현, ev11 최소 구현, ev10은 일회성 적재, ev12·ev13은 설계만 |

대상 3구 선정 근거 (2026-09 등록현황, 실제 행정동 427개 기준)

| 자치구 | 행정동 | 전기차 | 침투율 | 동별 침투율 범위 | 서비스링크 |
|---|---|---|---|---|---|
| 강남구 | 22 | 16,936 (1위) | 6.81% | 3.69~21.45% | 328 |
| 서초구 | 18 | 9,740 (2위) | 5.41% | 3.16~12.14% | 243 |
| 송파구 | 27 | 9,703 (3위) | 4.00% | 2.32~6.10% | 365 |

- 서울 전기차의 약 28%가 이 3구에 있다. 서울 평균 침투율은 4.06%.
- 강남·서초는 동별 편차가 커서 A 후보가 나오고, 송파는 서울 평균 수준이라 참고군 대조가 된다.
- 세 구가 붙어 있어 구 경계를 지나는 링크의 중점 귀속을 실제로 검증할 수 있다.
- 서비스링크 ID 앞 3자리(100~124)를 자치구 코드 순서로 보고 강남 122, 서초 121, 송파 123으로 골랐다. 이 대응은 추정이고, 링크 형상으로 행정동을 귀속할 때 확인한다.

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
| `ev01_traffic_collect` | 도로소통 폴링, 관측 이력, 시간대 집계 | `CronTriggerTimetable("0 * * * *")` (MVP 1시간) | cron | False | 1 | `ev_traffic_obs` (`record_coverage`) |
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
 ev01_traffic_collect ──write──▶ [ DB: core 관측·집계 / ops 상태·커버리지·게시 로그 ] ◀──read── ev03
   (Asset은 모니터링용)                                                                  ▲
 ev02_registration_monthly ──Asset: ev_reg_snapshot (extra: base_month, load_id) ──────┤ Asset OR
 ev10_master_refresh       ──Asset: ev_master_version (활성화 후) ────────────────────┤ daily cron
 ev11_reprocess ─┬─ registration: ev02 트리거 ──(Asset)────────────────────────────────┤
                 ├─ timeband: 재집계 → ev03 트리거(conf) ─────────────────────────────┤
                 └─ mart: ev03 트리거(conf) ───────────────────────────────────────────┘
 ev12_quality_monitor ──read──▶ Airflow 메타DB + ops ──▶ Slack
```

### 3.1 결합 방식

| 관계 | 방식 | 이유 |
|---|---|---|
| ev01 → ev03 | DB 상태 조회 | 10분마다 마트를 다시 계산할 이유가 없다 |
| ev02 → ev03 | Asset | 새 스냅샷을 바로 반영. `extra`는 대상 월 힌트로만 쓴다 |
| ev10 → ev03 | Asset | 검증된 마스터 버전 활성화는 재계산 사유 |
| ev03 자체 | daily cron (Asset과 OR) | 지각 데이터, 워터마크 도달, 보류 해소를 주기적으로 재평가 |
| ev11 → ev02/ev03 | 범위별 경로 하나 | 같은 월에 Asset 트리거와 명시 트리거가 겹치지 않게 (§4.5) |

### 3.2 쓰지 않은 대안

| 대안 | 이유 |
|---|---|
| `ExternalTaskSensor`로 ev01·ev02 완료 대기 | 10분 주기와 월 주기는 `execution_delta`로 맞출 수 없다. RFP의 "신규 실행을 기다리지 않는다"와도 충돌 |
| 수집부터 마트까지 단일 DAG | 월 배치 실패가 10분 수집을 막고, 재처리 범위가 DAG 전체가 된다 |
| ev01 Asset으로 ev03 트리거 | 하루 144번 마트 재계산 시도. 실행 이력이 skip으로 채워진다 |
| 링크마다 Task 생성 | Task 수 폭증. Dynamic Task Mapping으로 묶음 단위 생성 |
| Asset `extra`를 `params`처럼 사용 | `extra`는 `params`·`conf`로 넘어가지 않고, 이벤트 여러 개가 한 실행으로 합쳐질 수 있다 `[소스 확인]` |

---

## 4. DAG 상세

### 4.1 `ev01_traffic_collect` — 도로소통정보 수집

파티션 키는 `poll_batch_id`(수집 회차), 집계 키는 `link_id × 날짜 × 시간대`.

```
init_poll_batch ─▶ check_run_freshness (branch)
      ├─▶ skip_stale_run ───────────────────────────────────────────┐
      └─▶ get_target_links ─▶ plan_link_chunks                     │
            ─▶ extract_chunk.expand(chunk)     pool=seoul_traffic_api_pool, queue=api
            ─▶ validate_responses   [all_done_min_one_success]     │
            ─▶ quarantine_invalid ─▶ load_obs ─▶ aggregate_timeband│
            ─▶ record_coverage                 outlet: ev_traffic_obs
                                                                   ▼
                                          finalize_run_status  [all_done]
```

| Task | 하는 일 | trigger_rule | 실패 시 |
|---|---|---|---|
| `init_poll_batch` | `run_id`로 `poll_batch_id` 생성 | all_success | 재시도 |
| `check_run_freshness` | 시작이 너무 늦은 회차면 stale 분기 | all_success | — |
| `skip_stale_run` | 수집 안 함 | all_success | — |
| `get_target_links` | 대상 링크와 활성 링크 마스터 버전 조회. 사전 제외 링크는 사유 기록 | all_success | 재시도 |
| `plan_link_chunks` | N개 묶음으로 분할, 묶음 계획을 `ops`에 기록 `[미확정: N]` | all_success | 재시도 |
| `extract_chunk` | 묶음 호출, 원천 응답·링크별 상태를 staging에 저장, 끝나면 묶음 상태 `done` | all_success | 묶음 단위 백오프 재시도. 링크 단위 오류는 행으로만 기록. 인증·쿼터·묶음 전체 실패만 Task 실패 |
| `validate_responses` | staging과 `ops` 묶음 상태로 검증. mapped Task XCom에 의존하지 않음 | all_done_min_one_success | 재시도 |
| `quarantine_invalid` | 스키마 불일치·오염 레코드 격리 | all_success | 재시도 |
| `load_obs` | 유효 관측 멱등 적재 | all_success | 재시도 후 핵심 실패 |
| `aggregate_timeband` | 이번 회차가 건드린 시간대만 재계산 (UPSERT) | all_success | 재시도 후 핵심 실패 |
| `record_coverage` | 계획 대비 완료 묶음, 링크별 상태(성공/API 장애/무관측/대상 제외) 기록 | all_success | 재시도 후 핵심 실패 |
| `finalize_run_status` | 최종 상태 기록. 핵심 실패면 예외로 DAG 실패 처리 | all_done | — |

#### 4.1.1 실행 제어

동시 실행 방지와 실행 누적 방지는 다른 문제라서 따로 다룬다.

| 정책 | 수단 | 막는 것 | 못 막는 것 |
|---|---|---|---|
| 동시 실행 방지 | `max_active_runs=1` | 두 회차가 같은 링크를 동시에 호출·적재 | 실행 지연 |
| 예약 누적 방지 | `catchup=False` + `max_active_runs=1` | 밀린 예약 회차가 줄줄이 생성 | 수동 트리거 대기, 실행 중 pool 대기 |
| 지연 회차 폐기 | `check_run_freshness` → `skipped_stale` `[미확정: 허용 지연]` | 오래 기다린 회차의 뒤늦은 수집 | — |
| 실행 시간 상한 | `dagrun_timeout` ≈ 주기 × k `[미확정]` | 한 회차의 장시간 점유 | — |

Airflow 3.3.2 실제 동작 `[소스 확인]`
- 활성 실행이 `max_active_runs`에 닿으면 스케줄러는 새 예약 실행을 만들지 않는다 (`exceeds_max_non_backfill`).
- 활성 실행이 끝나면 `catchup=False`에서는 놓친 틱이 아니라 현재 시각 직전 틱으로 다음 실행을 잡는다 (`_align_to_prev(now)`).
- 그래서 정기 실행은 쌓이지 않고 틱을 건너뛴다.

건너뛴 틱과 커버리지
- 커버리지 분모는 회차가 아니라 링크 × 1시간 시간대로 고정돼 있다. 한 시간 안에서 몇 회차가 빠져도 대표 관측 허용 범위 안이면 영향이 없다.
- 한 시간대가 통째로 빠지면 그 링크-시간대는 분자에서 빠지고, `skipped_stale`·`failed` 회차와 연결해 사유를 남긴다.

폴링 주기는 실측한 회차 실행 시간(p95)이 주기보다 충분히 짧도록 묶음 크기, pool slots와 같이 정한다. `[미확정]`

#### 4.1.2 실패 유형과 최종 상태

| 상황 | 분류 | `ops` 상태 | DAG 실행 |
|---|---|---|---|
| 지연 회차 | — | `skipped_stale` | 성공 |
| 전부 성공 | 정상 | `success` | 성공 |
| 일부 묶음 실패, 핵심 단계 성공 | 허용된 부분 실패 | `partial` (실패분은 분모 포함·분자 제외) | 성공, 묶음 Task 콜백으로 알림 |
| 완료 묶음 비율이 최소 기준 미만 `[미확정]` | 허용된 부분 실패 | `partial` + 경보 | 성공 + 경보 |
| 모든 묶음 실패 | 핵심 실패 | `failed` | 실패 |
| 적재·집계·커버리지 기록 실패 | 핵심 실패 | `failed` | 실패 |

- `finalize_run_status`는 상태를 먼저 기록하고 예외를 던진다. `run_id` 키 UPSERT라 재시도해도 안전하다.
- 실시간 API는 지난 시점 값을 다시 주지 않는다. 대표 관측 허용 범위를 넘긴 실패는 재처리 대상이 아니라 결측으로 확정한다.
- `poll_batch_id`는 `run_id`에서 나오므로 재시도·Clear해도 같다. 적재는 `ON CONFLICT (link_id, poll_batch_id) DO NOTHING`.
- 진행 중인 시간대는 매 회차 UPSERT하고 시간대가 끝나면 확정한다. 대표 관측은 목표 시각에 가장 가까운 유효 관측, 동률은 사전 타이브레이커. `[미확정: 목표 시각·허용 범위]`

---

### 4.2 `ev02_registration_monthly` — 등록현황 월 배치

파티션 키는 `base_month`. 실행 시각에서 대충 유도하지 않고 명시적으로 정한다.

```
resolve_base_month
  ─▶ wait_base_month_published  (sensor, reschedule, soft_fail=True)
  ─▶ choose_source (branch: Variable ev_reg_source_mode = api | csv)
        ├─▶ extract_reg_api
        └─▶ extract_reg_csv
  ─▶ validate_base_month   [none_failed_min_one_success]
  ─▶ reconcile_totals ─▶ normalize_admdong_fuel ─▶ quarantine_unmapped ─▶ snapshot_gate
  ─▶ compare_with_existing (branch)
        ├─▶ skip_identical
        └─▶ load_snapshot           outlet: ev_reg_snapshot (extra={base_month, load_id, request_id})
  ─▶ record_run  [all_done]
```

#### 4.2.1 기준월과 센서

| 실행 유형 | `base_month` | 센서 조건 | 센서 미충족 시 |
|---|---|---|---|
| 정기 (cron) | `logical_date`(KST) 월 − 공표 지연 개월 `[미확정: 1개월 가정]` | 이 월이 원천에 공표됐나 | reschedule 대기 → timeout `[미확정]` → soft_fail → `publication_delayed` 기록·알림 |
| 특정 월 재처리 (`params.base_month`) | `params` 우선 | 같음. 이미 공표된 월이면 바로 통과 | 원천에 없으면 요청 오류로 실패 |
| 적재한 월의 재공표 | 위와 같음 | 같음 | — |

- v0.1의 "원천 최신 월 > 마지막 적재 월" 조건은 버렸다. 같은 월을 다시 받을 때 센서가 끝없이 기다리고, 감지한 월과 실행이 기대한 월이 어긋날 수 있어서다.
- `CronDataIntervalTimetable`의 `data_interval_start`에 기대는 방식도 버렸다. `resolve_base_month` 한 곳에서 계산하니 테스트도 쉽다.
- 중간 월 누락은 ev12가 잡고, 보완은 ev11로 한다.

#### 4.2.2 재공표 처리

| 비교 결과 | 처리 | `ops` 상태 | Asset |
|---|---|---|---|
| 해당 월 스냅샷 없음 | 신규 적재, `load_id` 발급 | `success` | 발생 |
| 있음, 내용 같음 | 적재 생략 | `unchanged` | 없음 (ev03 불필요 실행 방지) |
| 있음, 내용 다름 | 차이(행 수·합계·바뀐 행정동) 기록 후 파티션 교체 | `republished` | 발생 |

- `load_snapshot`은 `base_month` 파티션을 한 트랜잭션에서 delete + insert.
- `record_run`(`all_done`)이 `success`·`republished`·`unchanged`·`publication_delayed`·`failed` 중 하나로 확정. `failed`면 예외.
- 자동 소급은 `catchup=False`로 막는다. 소급은 ev11(`registration`)이 표준 경로다. `airflow backfill create`도 되지만 사유가 남지 않는다.

---

### 4.3 `ev03_mart_integration` — 통합 마트

파티션 키는 `base_month`, 도로 분석 기간은 같은 월. 한 번 실행에 기준월 하나.

```
resolve_target_period (branch)
  ├─▶ no_eligible_period ──────────────────────────────────────────┐
  └─▶ [gate1_run_eligibility]  병렬                                 │
        check_reg_snapshot · check_traffic_freshness · check_coverage
        · check_master_version · check_min_timebands               │
      ─▶ evaluate_gate1 (branch)                                   │
            ├─▶ hold_publish ─▶ mark_stale_and_alert ─────────────┤
            ├─▶ skip_unchanged ───────────────────────────────────┤
            └─▶ spatial_join ─▶ admdong_timeband_agg ─▶ compute_indicators
                 ─▶ region_quality_gate (Gate 2) ─▶ classify_abc   │
                 ─▶ build_mart_candidate ─▶ verify_candidate        │
                 ─▶ publish_mart        outlet: ev_mart_published  │
                                                                   ▼
                                              record_run_result  [all_done]
```

#### 4.3.1 대상 기준월 결정

후보는 dirty 월이다. 지금 입력 fingerprint가 마지막으로 평가(게시 또는 보류)한 fingerprint와 다른 월.

| 순서 | 출처 | 처리 |
|---|---|---|
| 1 | `dag_run.conf.base_month` (ev11, 수동) | 그 월. `force=True`면 fingerprint 비교 생략 |
| 2 | `triggering_asset_events`의 `extra.base_month` | 힌트로만 사용. DB에서 아직 dirty인지 확인 후 채택. 여러 개면 최신 월 |
| 3 | DB의 dirty 월 목록 | 최신 월 우선. 남은 건수는 `ops`에 기록하고 다음 실행에서 처리 |
| — | 후보 없음 | `no_eligible_period` (기간 미완료, 스냅샷 없음 등 입력 대기) |

- fingerprint = `hash(스냅샷 load_id, 분석 기간 집계 워터마크, 활성 링크 마스터 버전, 활성 경계 버전, 활성 임계값 버전)`
- 자동 재계산: 데이터 입력이 바뀐 월은 전부, 버전만 바뀐 경우는 최신 월만. 과거 월 버전 변경은 ev11로만 한다 (RFP §07 "마스터 변경 시 명시적 재실행").
- 보류도 평가 fingerprint를 남긴다. 그래서 보류된 월은 입력이 바뀔 때만 다시 후보가 되고, 매일 같은 보류를 반복하지 않는다.
- `skip_unchanged`는 실제로 fingerprint를 비교했을 때만 쓴다. 입력 대기(`no_eligible_period`)와 섞지 않기 위해서다.

#### 4.3.2 Task

| Task | 하는 일 | 실패·분기 |
|---|---|---|
| `check_reg_snapshot` | ⒜ 해당 월 스냅샷과 품질 등급 | 결과만 XCom으로 넘기고 실패시키지 않음 |
| `check_traffic_freshness` | ⒝ 마지막 정상 수집 시각. 수집 최신성만 보장, 원천 최신성은 별도 플래그 | 〃 |
| `check_coverage` | ⒞ 링크-시간 커버리지 (분모 사전 고정) | 〃 |
| `check_master_version` | ⒟ 링크 마스터·경계가 활성(검증 완료) 버전이고 서로 맞는지 | 〃 |
| `check_min_timebands` | ⒠ 지표 산출 최소 시간대 수 | 〃 |
| `evaluate_gate1` | 다섯 결과와 fingerprint 종합 | `hold` / `skip_unchanged` / `proceed` |
| `hold_publish` → `mark_stale_and_alert` | 이전 결과 유지, 게시 상태 `stale`, 알림 | — |
| `spatial_join` | (링크 버전, 경계 버전) 매핑이 있으면 재사용, 없으면 중점 귀속 계산 | Clear 재실행 |
| `admdong_timeband_agg` | 행정동 × 시간대 평균 속도. 도로 길이 가중 기본, 단순 평균 병행 | 〃 |
| `compute_indicators` | 판정 지표·보조 지표 | 〃 |
| `region_quality_gate` | Gate 2. 대상 행정동 전체에 품질 등급 부여 | 〃 |
| `classify_abc` | C → A → B → 참고군 순서. 원천 갱신 미검증이면 B 끄고 `b_suppressed` 기록 | 〃 |
| `build_mart_candidate` | 후보 테이블 생성. 운영 마트는 안 건드림 | 〃 |
| `verify_candidate` | §4.3.3 완전성 검사 | 실패면 게시 안 함, 운영 마트 유지 |
| `publish_mart` | §4.3.3 게시 트랜잭션 | 롤백, 운영 마트 유지 |
| `record_run_result` | upstream 상태와 게시 로그로 실행 결과 확정 (§4.3.4) | — |

#### 4.3.3 지역별 결과와 게시

후보 마트에는 대상 행정동이 하나도 빠짐없이 들어간다. 판정 못 한 지역도 행을 빼지 않고 상태로 남긴다.

| `classification` | 의미 | 조건 (RFP §03) |
|---|---|---|
| `A` / `B` / `REF` | 규모·추세 우위 / 환경 변동 큼 / 참고군 | 품질 정상 또는 경고 |
| `C` | 결과는 유효하지만 기준 미달, 데이터 보완 대상 | 품질 기준 미달 |
| `WITHHELD` | 결과를 믿을 수 없어 분류 보류 | 품질 치명 |

`verify_candidate` 통과 조건
- 후보 행 수 = 활성 경계 버전의 대상 행정동 수
- (행정동, `base_month`) 중복 없음
- `classification` null 없음
- 분류 분포 급변이 경보 기준 이내 `[미확정]`

`publish_mart` (한 트랜잭션)
1. 운영 마트의 해당 `base_month` 행을 지우고 후보 전체를 넣는다. UPSERT만 하면 후보에 없는 지역의 옛 결과가 남는다.
2. 같은 트랜잭션에서 게시 로그(`base_month`, `run_id`, fingerprint, 입력 `load_id`, 마스터·경계·임계값 버전, `published_at`)와 게시 상태 `current`를 쓴다.

게시와 계보가 같이 커밋되니 "게시는 됐는데 계보가 없는" 상태는 생기지 않는다.

게시 상태 (`base_month` 단위)

| 상태 | 의미 |
|---|---|
| `current` | 최신 입력으로 게시됨 |
| `stale` | Gate 1 보류로 이전 결과 유지 중. 사유와 함께 최신 아님 표시 |
| `never_published` | 아직 게시된 적 없음 |

조회 뷰는 마트와 게시 상태를 조인해 기준월, 도로 분석 기간, 마지막 정상 게시 시각, 현재 상태를 같이 보여준다 (RFP §09).

#### 4.3.4 실행 결과 확정

| 경로 | `ops` 상태 | DAG 실행 |
|---|---|---|
| `no_eligible_period` | `no_eligible_period` (대기 사유 포함) | 성공 |
| `skip_unchanged` | `skipped_unchanged` | 성공 |
| `hold_publish` | `held` (실패한 Gate 1 항목) | 성공 |
| `publish_mart` 성공 | `published` | 성공 |
| 처리 Task 또는 `verify_candidate` 실패 | `failed` (운영 마트 변경 없음) | 실패 |

- `record_run_result`는 `all_done`이라 보류·실패·무변경에서도 돈다.
- `run_id` 키 UPSERT라 이 Task만 다시 돌려도 된다.
- 게시 여부는 게시 로그가 기준이다. 상태 기록이 실패해도 게시 사실은 남아 있어서, DAG를 다시 돌려 `skipped_unchanged`가 나와도 계보는 잃지 않는다.

---

### 4.4 `ev10_master_refresh` — 마스터 갱신

```
detect_source_files ─▶ load_master_staging ─▶ register_version (pending)
  ─▶ validate_geometry ─▶ build_link_admdong_map ─▶ validate_mapping_quality
  ─▶ activate_version (active)   outlet: ev_master_version
  ─▶ record_run [all_done]
```

- 등록과 활성을 나눈다. `pending`으로 등록하고, 기하 검증(SRID, `ST_IsValid`, 경계 중복·틈, A↔C 링크ID 조인율)과 매핑 품질(성공률, 미귀속 비율)을 통과해야 `active`.
- ev01·ev03는 `active`만 쓴다. 검증 실패 버전은 `rejected`로 남고 Asset도 안 나간다.
- 버전은 추가만 한다. 과거 마트 재현용.

### 4.5 `ev11_reprocess` — 재처리 진입점

`params`(JSON Schema 검증): `scope` ∈ {`registration`, `timeband`, `mart`}, `base_months`, `date_from`/`date_to`, `force`(기본 False), `reason`(필수)

```
validate_request ─▶ register_request (request_id 발급) ─▶ route_scope (branch)
  ├─ registration ─▶ trigger_ev02.expand(base_month)   conf={base_month, request_id}, wait
  │                   ev03는 ev02의 Asset으로 실행. 여기서 직접 트리거하지 않음
  ├─ timeband ─────▶ reaggregate_timeband ─▶ trigger_ev03.expand(base_month)  conf={base_month, request_id}, wait
  └─ mart ─────────▶ trigger_ev03_mart.expand(base_month)  conf={base_month, force, request_id}, wait
─▶ record_request_result  [all_done]
```

| 범위 | 재처리 작업 | 통합 DAG 실행 | 결과 기록 |
|---|---|---|---|
| `registration` | ev02 월별 재실행 | ev02 Asset → ev03. 명시 트리거 없음. ev02가 `unchanged`면 ev03도 안 돈다 | ev02 결과. ev03 결과는 `extra.request_id`로 게시 로그에 연결 |
| `timeband` | 기간 재집계 | ev03 명시 트리거. 워터마크가 바뀌니 `force` 불필요 | ev03 결과 |
| `mart` | 없음 (임계값·마스터 변경, 로직 수정) | ev03 명시 트리거, 필요하면 `force` | ev03 결과 |

- 여러 월은 mapped `TriggerDagRunOperator`로 요청하고, ev03의 `max_active_runs=1`이 순서대로 처리한다.
- 재처리와 정기 cron이 겹쳐 중복 실행이 나도 두 번째는 fingerprint가 같아 `skipped_unchanged`로 끝난다.

### 4.6 `ev12_quality_monitor` / `ev13_retention_cleanup`

ev12는 두 곳을 같이 본다.

| 확인 | 출처 |
|---|---|
| 실행 상태 (성공/실패/미수행/수행 중) | Airflow 메타DB (강의 `dags_daily_dag_monitoring` 패턴) |
| 데이터 상태 (`partial`, `held`, `stale`, `publication_delayed`, 오래 계속되는 `no_eligible_period`, 기준월 누락, 커버리지 추이, 수집 최신성) | `ops` |
| 불일치 (DAG 성공인데 데이터는 `partial`·`held`) | 두 출처 조인. 리포트 핵심 |

ev13은 보존 기간이 지났다고 바로 지우지 않는다. 아래 조건을 다 만족해야 정리한다.

| 대상 | 삭제 조건 |
|---|---|
| 원천 관측 이력 | 보존 기간 경과 `[미확정]`, 시간대 집계 확정, 해당 월 `current` 게시, 그 기간에 열린 ev11 요청 없음 |
| staging | run 상태 확정, 보존 기간 경과 |
| quarantine | 보존 기간 경과, 사유 집계가 `ops`에 기록됨 |
| 집계, 스냅샷, 게시 로그, 마스터 버전 | 삭제 안 함 (계보·재현 근거) |

---

## 5. 품질 게이트

| 게이트 | 위치 | 단위 | 판정 | 결과 |
|---|---|---|---|---|
| Gate 0 수집 완결성 | ev01 `record_coverage`, ev02 `snapshot_gate` | 회차 / 기준월 | 완료 묶음 비율, 총건수 대조 | `success` / `partial` / 치명이면 적재 차단 |
| Gate 1 전체 적격성 | ev03 `evaluate_gate1` | 기준월 | 기준월, 스키마, 활성 마스터, 분석 기간 | 미달이면 게시 보류(`held`), 이전 결과 `stale` |
| Gate 2 지역별 품질 | ev03 `region_quality_gate` | 행정동 | 커버리지, 매핑, 관측량, 등록 품질 | 아래 표 |

| 등급 | 예 | 처리 |
|---|---|---|
| 치명 | 기준 기간 식별 불가, 필수 데이터 무효 | `WITHHELD` (행은 남기고 결과는 제공 안 함) |
| 기준 미달 | 커버리지·매핑·관측 품질 미달 | `C` |
| 경고 | 선택 필드 누락 | 해당 지표만 제한, 경고 기록 |
| 정상 | — | `A` / `B` / `REF` |

일부 행정동 미귀속은 그 지역만 C나 `WITHHELD`로 처리하고 나머지 갱신은 막지 않는다. 전 행정동 매핑 불가면 Gate 1에서 전체 보류.

---

## 6. 멱등성

| 데이터 | 멱등 키 | 적재 방식 |
|---|---|---|
| staging 원천 | `run_id` (+ 묶음 번호) | run 단위 delete + insert |
| ops 묶음 계획·상태 | `(poll_batch_id, chunk_no)` | UPSERT |
| 도로 관측 이력 | `(link_id, poll_batch_id)` | `ON CONFLICT DO NOTHING` |
| 링크 시간대 집계 | `(link_id, 날짜, 시간대)` | UPSERT (영향 시간대만) |
| 등록 스냅샷 | `base_month` | 내용 해시 비교 후 트랜잭션 delete + insert, `load_id` 발급 |
| 링크-행정동 매핑 | `(link_master_ver, boundary_ver)` | 버전별 추가만 |
| 분석 마트 | `base_month` | 후보 검증 후 파티션 교체 + 게시 로그, 한 트랜잭션 |
| ops 실행 상태 | `(dag_id, run_id)` | UPSERT |

`ON CONFLICT DO NOTHING`은 같은 배치에서 나중에 온 수정값을 버린다. 원천이 배치 안에서 안 바뀌는지 실증으로 확인하고, 정정이 필요하면 ev11로 처리한다 (RFP §07).

---

## 7. 재처리

| 상황 | 단위 | 경로 |
|---|---|---|
| ev01 묶음 API 일시 실패 | mapped index | 자동 백오프 재시도. 소진되면 `partial`로 진행 |
| ev01 적재·집계 실패 | 실패 Task부터 | UI Clear (downstream 포함). staging이 남아 있어 API 재호출 불필요 |
| ev02 공표 지연 | `base_month` | soft_fail → `publication_delayed` 알림 → 공표 후 ev11 `registration` |
| ev02 재공표·정정 | `base_month` | ev11 `registration` → ev02 → 내용 바뀌면 Asset → ev03 |
| 지각 도로 데이터 | 날짜 범위 | ev11 `timeband` → 재집계 → ev03 명시 트리거 |
| 마스터 버전 변경 | 최신 월 자동, 과거 월 요청 | ev10 활성화 → Asset → ev03(최신 월). 과거 월은 ev11 `mart` |
| 임계값 변경 | 지정 기준월 | 새 임계값 버전 등록 → ev11 `mart` |
| ev03 처리·검증 실패 | 해당 run | 운영 마트는 그대로. 실패 Task부터 Clear |
| ev03 게시 후 결과 기록만 실패 | `record_run_result` | 그 Task만 재시도. 게시 로그는 이미 있음 |
| ev03 Gate 1 보류 | 해당 기준월 | 원인이 풀리면 입력이 바뀌어 dirty가 되고 다음 정기 실행이 재평가 |

---

## 8. 상태 모델 (`ops`)

실행 상태 (`dag_id`, `run_id` 단위)

| 상태 | 의미 | DAG |
|---|---|---|
| `success` | 다 통과 | ev01, ev02, ev10 |
| `partial` | 일부 수집 실패, 성공분 적재 | ev01 |
| `skipped_stale` | 지연 회차라 수집 안 함 | ev01 |
| `unchanged` | 재공표 내용이 같아 적재 생략 | ev02 |
| `republished` | 같은 월을 다른 내용으로 재적재 | ev02 |
| `publication_delayed` | 공표 대기 시간 초과 | ev02 |
| `no_eligible_period` | 처리할 기준월 없음 (입력 대기) | ev03 |
| `skipped_unchanged` | fingerprint 같음 | ev03 |
| `held` | Gate 1 미달로 게시 보류 | ev03 |
| `published` | 게시 완료 | ev03 |
| `failed` | 핵심 단계 실패 | 전체 |

이 밖에 게시 상태(`base_month` 단위: `current`, `stale`, `never_published`)와 재처리 요청 상태(`request_id` 단위)를 따로 둔다.

---

## 9. 시간 기준

| 개념 | 정의 | 사용처 |
|---|---|---|
| `logical_date` / `run_after` | Airflow 실행 기준 시각 | 실행 식별, 지연 판정. 데이터 기간으로는 안 씀 |
| `collected_at` | 실제 수집 시각 | ev01 관측 이력, 수집 최신성 |
| `source_observed_at` | 원천 관측 시각, 없으면 NULL `[미확정]` | 원천 최신성, B 판정 활성 조건 |
| `base_month` | 등록 기준월. `resolve_base_month`가 결정 | ev02·ev03 파티션 |
| 도로 분석 기간 | 원안: `base_month`와 같은 월. MVP: 최근 완료 7일 (§0) | ev03 지표 |
| 워터마크 | 분석 기간 종료 + 지각 허용 `[미확정]` | dirty 월 판정 |

---

## 10. 운영 리소스

| 종류 | 이름 | 비고 |
|---|---|---|
| Pool | `seoul_traffic_api_pool`, `seoul_registration_api_pool` `[미확정: slots]` | API 키가 데이터셋별로 따로라 호출 제한도 따로 관리. slots는 `.env`로 조정 |
| Celery 큐 | `default` (워커 2대), `api` (워커 1대) | 외부 API 호출 Task는 `queue=api`. API 지연이 적재·집계 Task를 막지 않게 분리 |
| Connection | `conn_seoul_openapi`, `conn_postgis_ev`, `conn_db_postgres_airflow`, `conn_slack_airflow_bot` | 환경변수(`AIRFLOW_CONN_*`)로 등록. 메타DB 연결은 ev12용 |
| Variable | `apikey_seoul_traffic`, `apikey_seoul_registration`, `ev_reg_source_mode` | 환경변수(`AIRFLOW_VAR_*`)로 주입. 임계값은 Variable 말고 DB 버전 테이블 (계보 연결) |
| Asset | `ev_traffic_obs`, `ev_reg_snapshot`, `ev_master_version`, `ev_mart_published` | `plugins/common/assets.py`에서 한 번만 정의 |

---

## 11. 저장 계층 (잠정, API 실증 후 확정)

| 스키마 | 역할 | 주요 데이터 |
|---|---|---|
| `staging` | 원천 + run_id·collected_at·base_month | 도로·등록 원천 |
| `core` | 정제·이력·마스터 | 관측 이력, 링크 시간대 집계, 등록 스냅샷(load_id), 마스터 버전(pending/active/rejected), 링크-행정동 매핑 |
| `mart` | 게시 결과 | `fact_admdong_indicator`(`WITHHELD` 포함), 행정동 시간대 집계, `dim_admdong`·`dim_base_month`·`dim_timeband`, 후보 테이블 |
| `ops` | 운영·계보 | 실행 상태, 묶음 계획·상태, 커버리지, 품질 결과, 게시 로그·상태, 평가 fingerprint, 재처리 요청, 임계값 버전 |
| `quarantine` | 오염·미매핑 레코드 | 사유 코드와 함께 보존 |

---

## 12. 테스트 계획

아직 구현 전이다. 테스트가 생기기 전까지 아래 정책은 설계일 뿐 CI가 강제하지 않는다.

| 층위 | 테스트 | 내용 |
|---|---|---|
| 정적 | import 오류 | DagBag `import_errors` 없음 (RFP §08) |
| 정적 | 공통 정책 | 모든 DAG `catchup=False`, `tags`, `retries ≥ 1` |
| 정적 | `max_active_runs` | §2 표와 일치 |
| 정적 | Pool·큐 | `extract_chunk`는 `seoul_traffic_api_pool`, `extract_reg_api`는 `seoul_registration_api_pool`, 둘 다 `queue=api` |
| 정적 | Sensor 모드 | 전부 `reschedule` |
| 정적 | trigger_rule | ev01 `validate_responses=all_done_min_one_success`, `finalize_run_status=all_done` / ev02 `validate_base_month=none_failed_min_one_success`, `record_run=all_done` / ev03 `record_run_result=all_done` / ev11 `record_request_result=all_done` |
| 정적 | outlet 위치 | §2의 지정 Task에만 있고, upstream에 검증 Task(`verify_candidate`, `snapshot_gate`, `validate_mapping_quality`)가 있음 |
| 정적 | 최종 상태 Task | 핵심 DAG의 leaf가 `all_done` 상태 확정 Task 하나 |
| 단위 | 기준월 결정 | `resolve_base_month`: 정기, `params` 우선, KST 월 경계 |
| 단위 | 지연 회차 | `check_run_freshness` 경계값 |
| 단위 | 대상 월 선택 | conf > 이벤트 힌트(dirty 확인) > dirty 최신, 없으면 `no_eligible_period` |
| 단위 | 최종 상태 | §4.1.2, §4.3.4 표 각 행 |
| 통합 (DB) | 게시 원자성 | `verify_candidate` 실패나 트랜잭션 중 예외 시 운영 마트·게시 로그 변화 없음 |
| 통합 (DB) | 파티션 교체 | 이전에 A였던 지역이 `WITHHELD`가 되면 운영 마트도 `WITHHELD` |
| 통합 (DB) | 멱등 적재 | 같은 `poll_batch_id`·`base_month` 재적재 시 행 수 그대로 |
| 통합 (Airflow) | 분기 합류 | `dag.test()`로 분기마다 최종 Task가 돌고 상태가 맞는지 |

외부 API를 부르지 않는 fixture 테스트와 실제 API 통합 테스트는 분리한다 (RFP §08).

---

## 13. 미확정 항목

| 항목 | 정하는 방법 | 영향 |
|---|---|---|
| 묶음 크기, pool slots | 링크 936개 × 응답 0.1초 기준 실측. 폴링 주기는 1시간으로 확정 (§0) | ev01 병렬도 |
| 허용 지연, `dagrun_timeout` | 폴링 주기 확정 후 | `check_run_freshness` |
| 완료 묶음 최소 비율 | 응답 실패율 분포 | ev01 최종 상태 |
| 공표 지연 개월, 공표 일자 | 10/27 기준 최신 202609. 1~2개월로 보고 몇 달 관측 | `resolve_base_month`, 센서 timeout |
| 일일 호출 한도 | 명시 없음 (1회 1,000건 제한만 있음). 운영 중 오류 코드로 감시 | ev01 Pool, 실패 분류 |
| 키 중복 행 처리 | 합산 또는 격리. 중복 3건 원인 확인 후 결정 | ev02 정제 |
| 대표 관측 목표 시각·허용 범위 | 폴링 주기 확정 후 | ev01 집계, 커버리지 |
| 지각 허용 (워터마크) | 수집 지연 분포 | dirty 월 판정 |
| 분류 임계값, 분포 급변 기준 | 실제 분포(분위수) + 민감도 검토 | `classify_abc`, `verify_candidate` |
| 보존 기간 | 실제 수집량 | ev13 |

---

### 13.1 실증으로 확정된 항목 (2026-10-27, `scripts/verify_apis.py`)

| 항목 | 결과 | 설계 영향 |
|---|---|---|
| 도로소통 응답 필드 | `link_id`, `prcs_spd`, `prcs_trv_time` (소문자). XML만 지원 | 파싱 시 필드명 대문자 통일 |
| 링크 일괄 조회 | 불가. 1회 1링크. 잘못된 ID나 복수 ID는 `INFO-200` | 호출 수 = 링크 수. `INFO-200`은 링크 목록 검증 전까지 원인 구분 불가 |
| 원천 관측시각 | 없음 | `source_observed_at` NULL, 유형 B 비활성 |
| 갱신 특성 | 1분 간격 6회 중 값 3번 변경 (링크 1개 표본) | 수 분 단위 갱신으로 추정. 1시간 폴링에 충분 |
| 링크 길이 | 속도 × 여행시간이 매번 약 3.0km로 일정 | 형상 없이도 길이 추정 가능 (가중 평균 보조) |
| 등록현황 API | 최신 월(202609) 5,178건만. 기준월 인자 없음 | 과거 월은 파일로만. ev02의 특정 월 재처리는 파일 경로 전제 |
| 행정동 코드 | 10자리 행안부 코드 519개, 실제 행정동 427개. 나머지는 `기타`·폐지 동 | 활성 경계에 없는 코드는 격리 |
| 데이터 품질 | 키 중복 3건, 이름 끝 공백 5,093건, 0대 조합은 행 없음, `SUM_TOT` 불일치 0건 | 정제 규칙 |
| 링크 매핑 (OA-15061) | 서비스링크 5,073개 → 표준링크 11,513개 (1:N). 형상 없음 | 형상은 국가 표준노드링크 SHP 별도 필요 |

## 14. Airflow 3.3.2 동작 검증

| 항목 | 상태 | 근거 |
|---|---|---|
| `max_active_runs` 도달 시 새 예약 실행 안 만듦 | `[소스 확인]` | `scheduler_job_runner`의 `exceeds_max_non_backfill` |
| `catchup=False`면 놓친 틱 건너뛰고 직전 틱 실행 | `[소스 확인]` | `timetables/trigger.py`의 `_align_to_prev(utcnow())` |
| `AssetOrTimeSchedule`, `CronTriggerTimetable`, `CronDataIntervalTimetable`을 `airflow.sdk`에서 제공 | `[소스 확인]` | `airflow/sdk/__init__.py` |
| Asset 이벤트는 Task 성공 시에만 | `[소스 확인]` | `task_runner._handle_current_task_success` |
| 같은 Asset 이벤트 여러 개가 실행 하나로 합쳐짐 | `[소스 확인]` | `AssetDagRunQueue` PK = (asset_id, target_dag_id) |
| `all_done_min_one_success` 존재, upstream 전부 실패면 upstream_failed | `[소스 확인]` | `ti_deps/deps/trigger_rule_dep.py` |
| `triggering_asset_events`로 `extra` 읽기 | `[파싱 검증 예정]` | 컨텍스트 키는 확인. 실제 접근은 `dag.test()`로 |
| mapped `TriggerDagRunOperator` + `wait_for_completion` + deferrable | `[파싱 검증 예정]` | ev11 구현 때 |
| 분기 후 `all_done` 합류와 DAG 최종 상태 | `[파싱 검증 예정]` | §12 통합 테스트 |

---

## 15. 변경 이력

### v0.2 (2026-10-27) 리뷰 반영

| # | 지적 | 판정 | 반영 |
|---|---|---|---|
| ① | `max_active_runs=1`로는 실행 누적을 못 막음 | 일부 타당. `catchup=False` 정기 실행은 쌓이지 않고 틱을 건너뛴다(소스 확인). 다만 "다음 실행은 대기"라는 표현이 틀렸고, 수동 회차·pool 대기·커버리지 영향은 빠져 있었다 | §4.1.1 정책 네 가지로 분리, `check_run_freshness`·`dagrun_timeout` 추가 |
| ② | 센서 조건과 `base_month` 불일치 | 타당 | §4.2.1 `resolve_base_month`, 센서는 대상 월 공표만 확인, soft_fail. §4.2.2 재공표 비교 |
| ③ | ev11 Asset 트리거와 명시 트리거 중복 | 타당 | §4.5 범위별 경로 하나로 정리, fingerprint는 안전망 |
| ④ | 부분 실패 DAG의 최종 상태 모호 | 타당 | §4.1.2 허용된 부분 실패와 핵심 실패 구분, `finalize_run_status`, `all_done_min_one_success` |
| ⑤ | 치명 지역의 옛 결과 잔존 | 타당 | §4.3.3 전 행정동 포함, `WITHHELD`, 파티션 교체, 게시 상태 |
| 4.1 | 변경 없음과 대상 없음 혼동 | 타당 | `no_eligible_period` 분리 |
| 4.2 | Asset `extra` ≠ `params` | 타당 | §4.3.1 이벤트는 힌트, 대상은 DB dirty 월 |
| 4.3 | 실패 시 계보 미기록 | 타당 | `record_run_result`(all_done). 계보를 게시 트랜잭션 안으로 옮겨 원자화 |
| 5 | CI 정책은 문서뿐 | 타당 | §12 테스트 계획으로 바꾸고 미구현 명시, 게시 원자성·파티션 교체 테스트 추가 |
| 5 | ev10·ev12·ev13 보완 | 타당 | ev10 pending → active, ev12 교차 확인, ev13 조건부 삭제 |
| 6-4 | Airflow 3.3.2 검증 | 타당 | §14 소스 확인 6건, 파싱 검증 예정 3건 |

그 밖에 ev02 timetable을 `CronTriggerTimetable` + 명시적 기준월 결정으로 바꾸고, ev03 대상 선택을 dirty 월 방식으로 정했다.

### v0.1 (2026-10-27)
- 최초 초안
