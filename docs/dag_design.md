# DAG 설계서 - 서울 전동화 입지 인사이트 플랫폼

| 항목 | 내용 |
|---|---|
| 버전 | v0.5 (2026-10-29) - 구현 기준으로 전면 정리 |
| 대상 | 현대오토에버 데이터 플랫폼 운영 직무 과제 1 (Airflow·선후행·재처리) |
| 환경 | Airflow 3.3.2 (CeleryExecutor), PostgreSQL 16 + PostGIS |
| 범위 | DAG·Task 분리, 선후행, 실행 제어, 품질 게이트, 멱등성, 재처리 |

## 목차

1. [MVP 범위](#1-mvp-범위)
2. [설계 원칙](#2-설계-원칙)
3. [DAG 구성](#3-dag-구성)
4. [DAG 상세](#4-dag-상세)
   - [ev01 도로소통 수집](#41-ev01-도로소통-수집)
   - [ev02 등록현황 월 배치](#42-ev02-등록현황-월-배치)
   - [ev03 통합 마트](#43-ev03-통합-마트)
   - [ev10 마스터 갱신](#44-ev10-마스터-갱신)
   - [ev11 재처리](#45-ev11-재처리)
   - [ev12 품질 리포트](#46-ev12-품질-리포트)
   - [ev13 보존 정리](#47-ev13-보존-정리)
5. [품질 게이트와 분류](#5-품질-게이트와-분류)
6. [멱등성과 재처리](#6-멱등성과-재처리)
7. [상태 모델](#7-상태-모델)
8. [시간 기준](#8-시간-기준)
9. [운영 리소스](#9-운영-리소스)
10. [저장 계층](#10-저장-계층)
11. [테스트와 CI](#11-테스트와-ci)
12. [남은 과제](#12-남은-과제)
13. [부록: 실증과 Airflow 동작 확인](#13-부록-실증과-airflow-동작-확인)
14. [변경 이력](#14-변경-이력)

---

## 1. MVP 범위

RFP 원안대로면 첫 게시가 2027년 1월 이후다. 도로 API는 현재 값만 주고, 등록현황은 익월 중순에 공표된다. 제출 일정에 맞춰 범위를 줄였다.

| 항목 | RFP 원안 | MVP |
|---|---|---|
| 도로 분석 기간 | 등록 기준월과 같은 월 | 2026-10-27 17:30 ~ 10-28 12:00 (ev03 `params`). 결과에 `period_mismatch=true` |
| 대상 지역 | 서울 전체 | 강남·서초·송파 67개 행정동, 서비스링크 914개 |
| 폴링 주기 | 수 분 | 30분 (:00, :30) |
| 등록 이력 | API | 2026-09는 API, 2025-09 ~ 2026-08은 파일(`source=file`) 백필. 13개월 |
| 유형 B (환경 변동) | 활성 | 비활성. 원천에 관측 시각이 없음 |
| 도로 지표 | 유형 B 판정 | 수요 판정에 안 씀(모든 차량 속도). 품질 확인과 동네 도로 여건에만 사용 |
| 초기 관측 | - | ev01 완성 전 `scripts/bootstrap_collector.py`가 같은 staging에 적재, ev01이 미처리 회차로 흡수 |

대상 3구 선정 근거 (2026-09 등록현황)

| 자치구 | 행정동 | 전기차 | 침투율 | 서비스링크 |
|---|---|---|---|---|
| 강남구 | 22 | 16,936 (1위) | 6.81% | 328 |
| 서초구 | 18 | 9,740 (2위) | 5.41% | 243 |
| 송파구 | 27 | 9,703 (3위) | 4.00% | 365 |

- 서울 전기차의 약 28%. 서울 평균 침투율 4.06%
- 세 구가 붙어 있어 구 경계를 지나는 링크의 동 귀속을 검증할 수 있음
- 대상 링크는 ID 앞자리가 아니라 지도상 중점 귀속으로 결정 (앞자리 기준이면 도시고속도로 24개 누락)

---

## 2. 설계 원칙

Task 성공과 데이터 준비 완료는 다르다. 세 가지를 따로 판단하고 따로 기록한다.

| 판단 | 질문 | 위치 | 미충족 시 |
|---|---|---|---|
| 실행 상태 | 작업이 끝까지 돌았나 | retry·Slack 콜백, DAG별 최종 상태 Task | 핵심 단계 실패면 DAG 실패 |
| 데이터 완결성 | 필요한 데이터가 다 모였나 | ev01 커버리지, ev02 스냅샷 게이트 | `partial` 기록, 실행은 성공 |
| 데이터 적격성 | 판정해도 되나 | ev03 Gate 1·2 | 게시 보류(`held`) 또는 지역별 `C`·`WITHHELD` |

구조 원칙
1. 갱신 주기와 실패 조건이 다른 소스는 DAG를 나눈다
2. 트리거는 시작 계기일 뿐. 처리할 기준월과 진행 여부는 DB 상태로 정한다
3. 모든 적재는 정해진 키로 다시 돌려도 결과가 같다
4. 재처리 범위마다 진입 경로는 하나 (ev11)
5. 마지막 Task는 `all_done`으로 항상 실행되고 최종 상태를 기록한다
6. Task 본문은 얇게, 로직은 `files/sqls/<dag>/*.sql`

---

## 3. DAG 구성

| dag_id | 책임 | 스케줄 | Asset 발생 (Task) |
|---|---|---|---|
| `ev01_traffic_collect` | 도로소통 수집, 시간대 집계 | `0,30 * * * *` | `ev_traffic_obs` (`record_coverage`) |
| `ev02_registration_monthly` | 등록현황 월 스냅샷 | `0 9 1 * *`, 수동 | `ev_reg_snapshot` (`load_snapshot`) |
| `ev03_mart_integration` | 적격성 확인 → 지표·분류 → 마트 게시 | `0 6 * * *` 또는 Asset | `ev_mart_published` (`publish_mart`) |
| `ev10_master_refresh` | 링크 매핑·행정동 경계 버전 | 수동 | `ev_master_version` (`activate_version`) |
| `ev11_reprocess` | 재처리 요청 진입점 | 수동 | - |
| `ev12_quality_monitor` | 실행 상태 × 데이터 상태 리포트 | `0 8 * * *` | - |
| `ev13_retention_cleanup` | 조건부 보존 정리 | `0 3 * * 0` | - |

- 모든 DAG: `CronTriggerTimetable`(KST), `catchup=False`, `max_active_runs=1`
- 공통 `default_args`: 재시도 2회, 지수 백오프(최대 10분), `execution_timeout` 20분, 실패 시 Slack
- Asset 이벤트는 Task 성공 시에만 나가므로 검증을 통과한 뒤의 Task에만 붙인다

```
ev01 ──write──▶ [ DB: core 관측·집계 / ops 상태 ] ◀──read── ev03 (매일 06:00)
ev02 ──Asset: ev_reg_snapshot ────────────────────────────▶ ev03
ev10 ──Asset: ev_master_version ──────────────────────────▶ ev03
ev11 ─┬─ registration: ev02 트리거 (ev03는 ev02 Asset으로)
      ├─ timeband: 재집계 → ev03 트리거
      └─ mart: ev03 트리거
ev12 ──read──▶ Airflow 메타DB + ops ──▶ Slack
```

결합 방식

| 관계 | 방식 | 이유 |
|---|---|---|
| ev01 → ev03 | DB 조회 | 30분마다 마트를 다시 계산할 이유 없음 |
| ev02 → ev03 | Asset | 새 스냅샷 즉시 반영 |
| ev10 → ev03 | Asset | 마스터 버전 활성화는 재계산 사유 |
| ev03 자체 | 매일 06:00 (Asset과 OR) | 분석 기간 종료, 보류 해소를 주기적으로 재평가 |

쓰지 않은 대안

| 대안 | 이유 |
|---|---|
| `ExternalTaskSensor`로 수집 완료 대기 | 30분 주기와 월 주기는 `execution_delta`로 못 맞춤 |
| 수집부터 마트까지 단일 DAG | 월 배치 실패가 30분 수집을 막고, 재처리 범위가 DAG 전체가 됨 |
| ev01 Asset으로 ev03 트리거 | 하루 48번 재계산 시도, 실행 이력이 skip으로 채워짐 |
| 링크마다 Task | Task 폭증. 100개 묶음 단위 Dynamic Task Mapping |
| Asset `extra`를 `params`처럼 사용 | `extra`는 `params`로 안 넘어가고, 이벤트 여러 개가 실행 하나로 합쳐짐 |

---

## 4. DAG 상세

### 4.1 ev01 도로소통 수집

파티션 키 `poll_batch_id`(= `ev01__YYYYMMDDTHHMM`, `run_after` 기준), 집계 키 `link_id × 날짜 × 시간대`.

```
init_poll_batch ─▶ check_run_freshness (branch)
   ├─▶ skip_stale_run ────────────────────────────────────────┐
   └─▶ get_target_links ─▶ plan_link_chunks                   │
         ─▶ extract_chunk.expand (10개, pool·api 큐)            │
         ─▶ validate_responses [all_done_min_one_success]     │
         ─▶ quarantine_invalid ─▶ load_obs ─▶ aggregate_timeband
         ─▶ record_coverage (Asset)                           │
                                                              ▼
                                      finalize_run_status [all_done]
```

| Task | 하는 일 |
|---|---|
| `check_run_freshness` | 예약 시각보다 20분 넘게 늦게 시작하면 수집 생략. 다음 회차와 시간대가 겹치기 때문 |
| `plan_link_chunks` | 914개를 100개씩 10묶음, 계획을 `ops.poll_chunk`에 기록 |
| `extract_chunk` | 1회 1링크 호출. 링크 오류는 행으로 기록, 묶음 전체 실패만 Task 실패(재시도 3회) |
| `validate_responses` | 커버리지 기록이 없는 미처리 회차 전체를 처리 대상으로. XCom이 아니라 DB 기준 |
| `quarantine_invalid` | 숫자 아님, 속도 150km/h 초과, 여행시간 0 이하 격리 |
| `aggregate_timeband` | 이번 회차가 건드린 시간대만 재계산. 대표값은 HH:30에 가장 가까운 관측. 끝난 시간대는 확정(`is_final`) |
| `record_coverage` | 회차별 성공·무관측·API 오류·격리 건수. 기록되면 회차 처리 완료 |
| `finalize_run_status` | 최종 상태 기록. 핵심 단계 실패면 기록 후 예외 |

실패 처리
- 적재 단계에서 실패한 회차는 다음 실행의 `validate_responses`가 자동으로 다시 처리한다. 수동 Clear 불필요
- 실시간 API라 지난 값은 다시 못 받는다. 놓친 값은 결측으로 확정

| 상황 | `ops` 상태 | DAG |
|---|---|---|
| 20분 초과 지연 | `skipped_stale` | 성공 |
| 전부 성공 | `success` | 성공 |
| API 오류 있음, 또는 일부 묶음 실패 | `partial` | 성공 |
| 모든 묶음 실패, 또는 적재·집계·커버리지 실패 | `failed` | 실패 |

실행 제어
- `max_active_runs=1`: 두 회차가 같은 링크를 동시에 적재하지 않게
- `catchup=False`: 밀린 회차를 몰아서 만들지 않음. 스케줄러는 놓친 틱을 건너뛰고 직전 틱만 실행
- `dagrun_timeout` 25분: 한 회차가 다음 회차까지 점유하지 않게

### 4.2 ev02 등록현황 월 배치

파티션 키 `base_month`. 실행 시각에서 추정하지 않고 `resolve_base_month` 한 곳에서 정한다.

```
resolve_base_month ─▶ wait_base_month_published (Sensor)
  ─▶ choose_source (branch)
       ├─▶ extract_reg_api   (SeoulOpenApiHook)
       └─▶ extract_reg_file  (보고서 양식 xlsx 파서)
  ─▶ validate_base_month [none_failed_min_one_success]
  ─▶ reconcile_totals ─▶ normalize_admdong_fuel ─▶ quarantine_unmapped ─▶ snapshot_gate
  ─▶ compare_with_existing (branch)
       ├─▶ skip_identical
       └─▶ load_snapshot (Asset, extra: base_month·load_id·request_id)
  ─▶ record_run [all_done]
```

기준월
- `params.base_month`가 있으면 그 월, 없으면 실행 시각(KST) 전월
- API는 최신 월만 준다. 지난 월을 `source=api`로 요청하면 `resolve_base_month`에서 바로 실패 → `source=file`로 요청
- `SeoulApiBaseMonthSensor`: 대상 월이 원천에 나올 때까지 1시간 간격 `reschedule` 대기. 20일 초과 시 `soft_fail` → `publication_delayed`

재공표 처리

| 비교 결과 | 처리 | `ops` 상태 | Asset |
|---|---|---|---|
| 해당 월 없음 | 신규 적재 | `success` | 발생 |
| 있음, 내용 같음 | 적재 생략 | `unchanged` | 없음 (ev03 불필요 실행 방지) |
| 있음, 내용 다름 | 차이 기록 후 파티션 교체 | `republished` | 발생 |

- `load_snapshot`은 적재 이력과 파티션 교체(delete + insert)를 한 트랜잭션으로
- 과거 월 소급은 ev11 `registration`이 표준 경로

### 4.3 ev03 통합 마트

한 실행에 기준월 하나. 수집 DAG를 기다리지 않고 DB에 쌓인 값으로 판단한다.

```
resolve_target_period (branch)
  ├─▶ no_eligible_period ─────────────────────────────────────┐
  └─▶ gate1_run_eligibility (5개 점검 병렬)                     │
      ─▶ evaluate_gate1 (branch)                              │
           ├─▶ hold_publish ─▶ mark_stale_and_alert ──────────┤
           ├─▶ skip_unchanged ────────────────────────────────┤
           └─▶ spatial_join ─▶ admdong_timeband_agg ─▶ compute_indicators
               ─▶ region_quality_gate ─▶ classify_abc          │
               ─▶ verify_candidate ─▶ publish_mart (Asset)     │
                                                              ▼
                                         record_run_result [all_done]
```

대상 기준월과 fingerprint
- 기준월 = `params.base_month`, 없으면 `core.reg_snapshot`의 최신 월
- Asset `extra.base_month`는 힌트로 기록만 한다. 대상 결정에는 쓰지 않음
- fingerprint = 기준월·전년 동월 `load_id`, 도로 집계 워터마크, 활성 링크·경계 버전, 임계값 버전, 분석 기간, 대상 집합의 해시
- 직전 평가와 fingerprint가 같으면 `skip_unchanged` (`force=true`면 무시)
- 당월 스냅샷이나 활성 임계값이 없으면 `no_eligible_period`
- 과거 월 재계산은 ev11 `mart`로 기준월을 지정한다

| Task | 하는 일 |
|---|---|
| `gate1_run_eligibility` | 등록 스냅샷, 도로 최신성, 커버리지, 마스터 버전, 관측 시간대 수 점검 (§5). Task는 실패시키지 않고 결과만 반환 |
| `evaluate_gate1` | 하나라도 미달 → `hold_publish`, fingerprint 동일 → `skip_unchanged`, 그 외 진행 |
| `mark_stale_and_alert` | 지난 결과 유지, 게시 상태 `stale`, Slack 알림 |
| `spatial_join` | 활성 버전의 링크-행정동 귀속 결과 확인 |
| `admdong_timeband_agg` | 행정동 × 시간대 평균 속도 (길이 가중, 단순 평균) |
| `compute_indicators` | 후보 테이블에 대상 3구 행정동 전체 생성. 전기차 대수·증가율, 커버리지, 저속 비중 |
| `region_quality_gate` | Gate 2. 행정동마다 품질 등급 |
| `classify_abc` | 분류와 도로 여건 (§5) |
| `verify_candidate` | 행 수 = 대상 행정동 수, 중복 없음, 분류 null 없음, `A`인데 도로 여건 null 없음. 실패면 게시 안 함 |
| `publish_mart` | 한 트랜잭션: 해당 기준월 삭제 → 후보 전체 삽입 → 게시 로그·게시 상태 `current` |
| `record_run_result` | Task 상태로 실행 결과 확정 |

- 판정 못 한 지역도 행을 빼지 않고 `C`·`WITHHELD`로 남긴다. UPSERT만 하면 후보에 없는 지역의 옛 결과가 남기 때문
- 게시와 계보가 같이 커밋되므로 "게시됐는데 계보 없음" 상태는 생기지 않는다
- 보류는 Gate 1을 fingerprint보다 먼저 보므로, 원인이 그대로면 다음 정기 실행도 다시 `held`

| 경로 | `ops` 상태 | DAG |
|---|---|---|
| `no_eligible_period` | `no_eligible_period` | 성공 |
| `skip_unchanged` | `skipped_unchanged` | 성공 |
| `hold_publish` | `held` (미달 항목) | 성공 |
| `publish_mart` 성공 | `published` | 성공 |
| 처리·검증 실패 | `failed` (운영 마트 변경 없음) | 실패 |

게시 상태 (`base_month` 단위): `current` 최신 게시 / `stale` 보류로 지난 결과 유지 / `never_published` 미게시. 조회 뷰 `mart.v_admdong_result`가 결과와 게시 상태를 같이 보여준다.

### 4.4 ev10 마스터 갱신

```
register_boundary ─▶ load_link_mapping ─▶ check_std_source (branch)
   ├─▶ extract_std_link   (staging에 SHP 원본 있음)
   └─▶ reuse_std_link     (같은 SHP 버전 적재됨)
 ─▶ build_service_link [none_failed_min_one_success] ─▶ assign_admdong ─▶ link_quality
 ─▶ quality_gate (branch: 귀속률 ≥ 95%)
   ├─▶ activate_version (Asset) ─▶ build_target_link ─▶ cleanup_raw_shp
   └─▶ reject_version   (기존 활성 유지, 실행 결과 held)
 ─▶ record_run [all_done]
```

- 전국 SHP 원본은 `scripts/load_master.sh`가 staging에 넣고 ev10을 트리거
- 버전은 `pending` → `active` / `rejected` / `retired`. 추가만 하고 지우지 않음 (과거 결과 재현용)
- ev01·ev03은 `active`만 사용
- 현재 활성: 경계 `ver20260701`, 링크 `map20250306_shp20261014` (귀속률 98.42%)

### 4.5 ev11 재처리

`params`: `scope`(registration / timeband / mart), `base_months`, `source`·`file_name`, `date_from`·`date_to`, `window_start`·`window_end`, `force`, `reason`(필수)

```
validate_request ─▶ register_request ─▶ route_scope (branch)
  ├─ build_ev02_confs ──────▶ trigger_ev02.expand
  ├─ reaggregate_timeband ──▶ trigger_ev03_timeband.expand
  └─ build_mart_confs ──────▶ trigger_ev03_mart.expand
─▶ record_request_result [all_done]
```

| 범위 | 하는 일 | ev03 실행 |
|---|---|---|
| `registration` | ev02 월별 재실행 | ev02 Asset으로. 직접 트리거 안 함. `unchanged`면 ev03도 안 돎 |
| `timeband` | 기간 내 회차 시간대 재집계 | 명시 트리거. 워터마크가 바뀌어 `force` 불필요 |
| `mart` | 없음 (임계값·마스터 변경, 로직 수정) | 명시 트리거, 필요하면 `force` |

- 하위 DAG 대기는 `deferrable=True`. 대기 중 워커 슬롯을 비움
- 여러 월은 mapped 트리거, 하위 DAG `max_active_runs=1`이 순서대로 처리
- 요청 상태는 `ops.reprocess_request`에 `done` / `failed`

### 4.6 ev12 품질 리포트

```
[collect_airflow_runs (메타DB, 조회 전용)] ∥ [collect_data_status (ops)]
 ─▶ detect_mismatch ─▶ build_report ─▶ send_slack ─▶ record_run [all_done]
```

- 기본 최근 24시간 (`params.hours`)
- 불일치 = Airflow는 성공인데 데이터는 `partial`·`held`·`publication_delayed`·`skipped_stale`·`no_eligible_period` 등
- `ops` 기록이 없는 실행, ev01 회차 수(기대 48회/일)도 함께 보고
- 10/28 리포트에서 불일치 17건 탐지 (ev01 `partial`, ev03 `held`)

### 4.7 ev13 보존 정리

기본 `dry_run=true`, 보존 30일. 기간이 지났다고 바로 지우지 않는다.

| 대상 | 삭제 조건 |
|---|---|
| 도로 관측 이력 | 보존 기간 경과, 시간대 확정, 해당 기간 게시됨, 열린 ev11 요청 없음 |
| staging 도로 원천 | 회차 처리 완료, 보존 기간 경과 |
| staging 등록 원천 | 실행 상태 확정, 보존 기간 경과 |
| quarantine | 보존 기간 경과 |
| 집계, 스냅샷, 게시 로그, 마스터 버전 | 삭제 안 함 (계보·재현 근거) |

```
find_candidates ─▶ decide_delete (branch: dry_run)
   ├─▶ skip_delete     (후보·보호 사유만 기록)
   └─▶ delete_expired  (한 트랜잭션)
 ─▶ record_run [all_done]
```

---

## 5. 품질 게이트와 분류

| 게이트 | 위치 | 단위 | 미달 시 |
|---|---|---|---|
| Gate 0 수집 완결성 | ev01 `record_coverage`, ev02 `snapshot_gate` | 회차 / 기준월 | `partial`, 치명이면 적재 차단 |
| Gate 1 실행 적격성 | ev03 `evaluate_gate1` | 기준월 | 게시 보류(`held`), 지난 결과 `stale` |
| Gate 2 지역별 품질 | ev03 `region_quality_gate` | 행정동 | `C` 또는 `WITHHELD` |

Gate 1 점검 (하나라도 미달이면 보류)

| 점검 | 기준 |
|---|---|
| 등록 스냅샷 | 당월·전년 동월 존재, 품질 치명 아님 |
| 도로 최신성 | 분석 기간 종료, 마지막 수집이 종료 1시간 이내 |
| 커버리지 | 대상 링크 × 주간(07~21시) 시간대 중 관측 비율 60% 이상 |
| 마스터 버전 | 링크·경계 활성 버전 2개, 대상 링크가 활성 버전 소속 |
| 관측 시간대 | 주간 관측 시간대 6개 이상 |

Gate 2 등급과 분류 (임계값 `mvp_v2`, provisional)

| 등급 | 조건 | 분류 |
|---|---|---|
| 치명 `fatal` | 등록 데이터 없음, 또는 귀속 링크 0개 | `WITHHELD` 판단 보류 |
| 기준 미달 `below` | 링크 3개 미만, 커버리지 60% 미만, 유효 시간대 6개 미만 | `C` 데이터 보완 필요 |
| 경고 `warn` | 전년 동월 등록 없음 | 아래 판정 (증가율 없어 `A` 제외) |
| 정상 `ok` | - | 전기차 522대 이상 & 1년 증가율 39.7% 이상 → `A` 우선 검토, 그 외 `REF` 관찰 대상 |

- `A` 기준은 67개 동 상위 40% 경계(p60). 민감도 검토 전 잠정치
- `B`는 원천 관측 시각이 없어 비활성 (`b_suppressed=true`)

도로 여건 (`charger_hint`, 품질 통과 동만)

| 값 | 표시 | 저속 비중 (15km/h 미만 링크-시간 비율) |
|---|---|---|
| `fast` | 원활 | 13% 미만 (p33) |
| `mixed` | 보통 | 13% 이상 22% 미만 |
| `slow` | 혼잡 | 22% 이상 (p67) |

도로 속도는 전기차만의 값이 아니라 수요 근거로 쓰지 않는다. 현장 조사 전 참고값이고, 급속·완속 유형은 현장 조사에서 정한다.

월별 증가 양상 (`mart.v_reg_momentum`, 대시보드 보조 지표. 분류에는 안 씀)

| 양상 | 조건 |
|---|---|
| 한 달 몰림 | 1년 증가 20대 이상, 증가분 절반 이상이 한 달에 |
| 최근 가속 | 최근 3개월 증가율 10% 이상, 직전 3개월의 1.5배 이상 |
| 꾸준한 증가 | 12개월 중 10개월 이상 증가 |
| 정체·변동 | 그 외 |

---

## 6. 멱등성과 재처리

멱등 키

| 데이터 | 키 | 적재 방식 |
|---|---|---|
| staging 도로 원천 | `(poll_batch_id, link_id)` | UPSERT |
| 묶음 계획 | `(poll_batch_id, chunk_no)` | `ON CONFLICT DO NOTHING` |
| 도로 관측 | `(link_id, poll_batch_id)` | `ON CONFLICT DO NOTHING` |
| 링크 시간대 집계 | `(link_id, 날짜, 시간대)` | UPSERT (영향 시간대만) |
| 등록 스냅샷 | `base_month` | 내용 해시 비교 후 delete + insert, `load_id` 발급 |
| 링크-행정동 귀속 | `(link_ver, boundary_ver)` | 버전별 추가만 |
| 분석 마트 | `base_month` | 후보 검증 후 파티션 교체 + 게시 로그, 한 트랜잭션 |
| 실행 상태 | `(dag_id, run_id)` | UPSERT |

재처리 경로

| 상황 | 경로 |
|---|---|
| ev01 묶음 API 일시 실패 | 묶음 단위 자동 재시도, 소진되면 `partial`로 진행 |
| ev01 적재·집계 실패 | 다음 회차가 미처리 회차로 자동 흡수 |
| ev02 공표 지연 | `publication_delayed` 알림 → 공표 후 ev11 `registration` |
| ev02 재공표·정정, 과거 월 백필 | ev11 `registration` → ev02 → 내용 바뀌면 Asset → ev03 |
| 지각 도로 데이터 | ev11 `timeband` → 재집계 → ev03 |
| 마스터 버전 변경 | ev10 활성화 → Asset → ev03(최신 월). 과거 월은 ev11 `mart` |
| 임계값 변경 | 새 임계값 버전 활성화 → ev11 `mart` |
| ev03 처리·검증 실패 | 운영 마트 그대로. 실패 Task부터 Clear |
| ev03 Gate 1 보류 | 원인이 풀리면 다음 정기 실행이 재평가 |

정기 실행과 재처리가 겹쳐도 두 번째 실행은 fingerprint가 같아 `skipped_unchanged`로 끝난다. 과거 월 백필 중 Asset으로 ev03이 10번 깼지만, 최신 월 입력이 같아 모두 재계산을 생략했다.

---

## 7. 상태 모델

`ops.pipeline_run` (`dag_id`, `run_id` 단위)

| 상태 | 의미 | DAG |
|---|---|---|
| `success` | 정상 완료 | ev01, ev02, ev10~13 |
| `partial` | 일부 수집 실패, 성공분 적재 | ev01 |
| `skipped_stale` | 지연 회차라 수집 안 함 | ev01 |
| `unchanged` | 재공표 내용 같아 적재 생략 | ev02 |
| `republished` | 같은 월을 다른 내용으로 재적재 | ev02 |
| `publication_delayed` | 공표 대기 초과 | ev02 |
| `no_eligible_period` | 처리할 입력 없음 | ev03 |
| `skipped_unchanged` | fingerprint 동일 | ev03 |
| `held` | 게시 보류(ev03) / 귀속률 미달로 버전 거부(ev10) | ev03, ev10 |
| `published` | 게시 완료 | ev03 |
| `failed` | 핵심 단계 실패 | 전체 |

그 밖에 게시 상태(`ops.publish_status`)와 재처리 요청 상태(`ops.reprocess_request`)를 따로 둔다.

---

## 8. 시간 기준

| 개념 | 정의 | 사용처 |
|---|---|---|
| `run_after` | Airflow 실행 기준 시각 | 회차 ID, 지연 판정. 데이터 기간으로는 안 씀 |
| `collected_at` | 실제 수집 시각 | 관측 시간대, 도로 최신성 |
| `source_observed_at` | 원천 관측 시각 | 원천에 없음 → NULL, 유형 B 비활성 |
| `base_month` | 등록 기준월 | ev02·ev03 파티션 |
| 도로 분석 기간 | MVP: 2026-10-27 17:30 ~ 10-28 12:00 | ev03 지표 |
| 워터마크 | 분석 기간 내 확정 시간대의 마지막 갱신 시각 | fingerprint |

모든 시각은 KST 기준으로 계산한다. Airflow는 UTC로 저장하므로 월·시간대 경계는 변환 후 계산.

---

## 9. 운영 리소스

| 종류 | 이름 | 비고 |
|---|---|---|
| Pool | `seoul_traffic_api_pool`(4), `seoul_registration_api_pool`(2) | API 키가 데이터셋별로 따로. slots는 `.env` |
| Celery 큐 | `default` (워커 2), `api` (워커 1) | 외부 API Task는 `queue=api`. API 지연이 적재를 막지 않게 |
| Connection | `conn_seoul_openapi`, `conn_postgis_ev`, `conn_db_postgres_airflow`, `conn_slack_airflow_bot` | `AIRFLOW_CONN_*` 환경변수. 메타DB는 ev12 조회용 |
| Variable | `apikey_seoul_traffic`, `apikey_seoul_registration` | `AIRFLOW_VAR_*` 환경변수. 임계값은 DB 버전 테이블 |
| Asset | `ev_traffic_obs`, `ev_reg_snapshot`, `ev_master_version`, `ev_mart_published` | `plugins/common/assets.py`에서 한 번만 정의 |
| 커스텀 Hook | `SeoulOpenApiHook` | XML 파싱, 결과 코드 → ok / no_data / api_error, 전수 페이지, 링크 단위 부분 실패 허용 |
| 커스텀 Sensor | `SeoulApiBaseMonthSensor` | 원천 최신 기준월 = 대상 월이면 통과, `reschedule`, 파일 경로는 즉시 통과 |

---

## 10. 저장 계층

DDL은 `files/sqls/ddl/`, 적용은 `scripts/apply_ddl.sh`. 모두 `IF NOT EXISTS`라 재실행해도 안전하다.

| 스키마 | 주요 테이블 | 비고 |
|---|---|---|
| `staging` | `traffic_raw`, `registration_raw`, `registration_norm` | 원천 그대로. 등록은 API·파일 공통 |
| `core` | `traffic_obs`, `link_timeband`, `reg_snapshot` | 관측, 시간대 대표값, 월 스냅샷 |
| | `master_version`, `admdong`, `service_link_map`, `std_link`, `service_link`, `link_admdong`, `target_link`, `fuel_code` | 마스터. 대상 링크는 `mvp_3gu_v1` 914개, 전기차는 `fuel_code.is_ev` |
| `ops` | `pipeline_run`, `poll_chunk`, `poll_coverage`, `reg_load`, `quality_result` | 실행 상태, 수집·품질 근거 |
| | `threshold_version`, `mart_eval`, `publish_log`, `publish_status`, `reprocess_request` | 임계값 버전, fingerprint, 게시 계보, 재처리 요청 |
| `mart` | `fact_admdong_indicator`, `fact_admdong_timeband` | 운영 마트 (`base_month`, `adm_cd`) |
| | `candidate_admdong_indicator`, `candidate_admdong_timeband` | 실행별 후보, 검증 후 교체 |
| | `v_admdong_result`, `v_reg_trend`, `v_reg_monthly`, `v_reg_momentum`, `v_timeband_profile`, `v_active_threshold` | Rshiny 조회 뷰 |
| `quarantine` | `traffic_record`, `registration_record` | 사유 코드와 원문 |

Rshiny는 읽기 전용 계정 `rshiny_reader`로 `mart`, `ops`만 조회한다.

---

## 11. 테스트와 CI

`tests/` 16개. 외부 API를 부르지 않는다.

| 파일 | 내용 |
|---|---|
| `test_dag_integrity.py` | DAG import 오류 없음, `catchup=False`·`max_active_runs`·재시도, Pool·큐, 센서 `reschedule`, 최종 상태 Task가 `all_done` leaf |
| `test_custom_plugins.py` | Hook 응답 파싱·상태 판정, Sensor 통과 조건 |
| `test_db_split.py` | SQL 문장 분리 (psycopg 3 한 번에 한 문장) |
| `test_scripts.py` | 등록 xlsx 열 변환, 임시 수집기 회차 시각 정렬 |

CI (PR 필수 검사, GitHub Actions)

| 단계 | 내용 |
|---|---|
| `lint` | black, flake8 |
| `test` | pytest |
| `validate_dag` | DAG 로드 오류 0 |
| `validate_ddl` | 빈 PostGIS에 DDL 2회 적용 |

`build`(SHA 태그 이미지), `deploy`(main, 수동 승인)까지 포함한 6단계는 `.gitlab-ci.yml`로 설계.

실행으로 확인한 경로: ev02 3경로, ev03 보류·게시·무변경, ev10 재사용, ev11 요청 차단·mart 재처리, ev13 dry-run. 게시 트랜잭션과 파티션 교체의 자동 테스트는 아직 없다.

---

## 12. 남은 과제

| 항목 | 현재 | 할 일 |
|---|---|---|
| 분류 임계값 | `mvp_v2` provisional (p60, p33·p67) | 분포 누적 후 민감도 검토 |
| 분포 급변 경보 | 미구현 | `verify_candidate`에 직전 게시 대비 분포 변화 검사 |
| 완료 묶음 최소 비율 | 미구현 (API 오류 1건이라도 `partial`) | 오류율 분포 보고 경보 기준 설정 |
| 지각 허용 | 미구현 (확정 시간대만 사용) | 수집 지연 분포 확인 |
| 일일 호출 한도 | 명시 없음 (1회 1,000건 제한만) | 오류 코드로 감시 |
| 도로 분석 기간 | MVP 고정 기간 | 원안대로 기준월과 같은 월로 전환 |
| 게시 경로 자동 테스트 | 수동 확인만 | DB 통합 테스트 추가 |

---

## 13. 부록: 실증과 Airflow 동작 확인

API·원천 실증 (2026-10-27, `scripts/verify_apis.py`)

| 항목 | 결과 | 설계 영향 |
|---|---|---|
| 도로 API | XML만, 1회 1링크, 원천 관측 시각 없음 | 호출 수 = 링크 수, 유형 B 비활성 |
| 도로 갱신 | 1분 간격 6회 중 3번 변경 | 30분 폴링에 충분 |
| 등록 API | 최신 월만 제공, 기준월 인자 없음 | 과거 월은 파일 경로 |
| 등록 파일 | 보고서 양식(머리말·병합 셀·소계), 코드 없이 이름만 | 별도 파서, 이름 → 코드 매칭 |
| 행정동 코드 | 519개 중 실제 427개, 나머지는 기타·폐지 동 | 활성 경계에 없는 코드는 격리 |
| 링크 매핑 | 서비스링크 5,073 → 표준링크 11,513 (1:N), 형상 없음 | 국가 표준노드링크 SHP로 형상 구성 |
| 형상 조인 | 조인율 95.57%, 형상 없는 링크 59개 | `no_geometry`로 미귀속 |
| 행정동 귀속 | 3구 916개, 67개 동 모두 링크 3개 이상 | 대상 914개 확정 |
| 3구 증가율 (2025-09 → 2026-09) | 동별 -25.7 ~ 124.7%, 중앙값 36.4% | 분위수 임계값 산정 가능 |

Airflow 3.3.2 동작

| 동작 | 근거 |
|---|---|
| `max_active_runs` 도달 시 새 예약 실행 안 만듦 | 소스 (`exceeds_max_non_backfill`) |
| `catchup=False`면 놓친 틱 건너뛰고 직전 틱만 실행 | 소스 (`_align_to_prev`) |
| Asset 이벤트는 Task 성공 시에만, 여러 이벤트는 실행 하나로 합쳐짐 | 소스 |
| ev10 Asset → ev03 `asset_triggered` 실행 | 실행 |
| mapped `TriggerDagRunOperator` + deferrable 대기 | 실행 (ev11 → ev03) |
| 분기 후 `all_done` 합류, 핵심 실패 시 기록 후 DAG 실패 | 실행 |
| Task SDK `run_after`는 datetime | `pendulum.instance()` 변환 |
| `PostgresHook.get_conn()`은 psycopg 3 연결 | `executemany`, SQL 문장 단위 실행 |

---

## 14. 변경 이력

| 버전 | 날짜 | 내용 |
|---|---|---|
| v0.5 | 2026-10-29 | 구현 기준 전면 정리. 목차 추가, 대상 월 결정·보류 재평가·미구현 항목을 코드와 맞춤, 폴링 주기 30분 통일 |
| v0.4 | 2026-10-28 | 도로 지표를 동네 도로 여건(원활·보통·혼잡)으로 재정의, 등록 13개월 백필·월별 증가 양상 (#19~#21) |
| v0.3 | 2026-10-27 | 7개 DAG·Rshiny 구현, 커스텀 Hook·Sensor, ev01 30분 주기, 임계값 `mvp_v1` (#4~#15) |
| v0.2 | 2026-10-27 | 리뷰 반영: 실행 제어 정책 분리, 기준월 명시 결정, 재처리 경로 단일화, 부분 실패 상태, `WITHHELD`·파티션 교체 |
| v0.1 | 2026-10-27 | 최초 초안 |
