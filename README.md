# 서울 전동화 입지 인사이트 플랫폼

월 단위 전기차 등록현황과 실시간 도로소통정보를 각자 주기로 수집하고, 행정동 단위로 맞춰 충전소 우선 검토 지역을 고르는 Airflow 파이프라인. 우선 검토는 전기차 대수·증가율로 판정하고, 도로 저속 비중으로 동네 도로 여건(원활·보통·혼잡)을 함께 보여준다.

설계는 [docs/dag_design.md](docs/dag_design.md), 형상 관리 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md) 참고.

## 구성

| 서비스 | 역할 | 주소 |
|---|---|---|
| airflow-apiserver | Airflow UI·API | http://localhost:8080 |
| airflow-scheduler, dag-processor, triggerer | 스케줄링·DAG 파싱·deferrable 대기 | — |
| airflow-worker-default-1, -2 | 일반 처리 (`default` 큐) | — |
| airflow-worker-api | 외부 API 호출 (`api` 큐) | — |
| flower | 워커 모니터링 | http://localhost:5555 |
| postgis | 분석 DB (staging·core·mart·ops·quarantine) | localhost:5432 |
| postgres | Airflow 메타데이터 DB | localhost:5431 |
| rshiny | 운영 현황·규모×추세·월별 추세·시간대 속도·분류 결과 대시보드 | http://localhost:3838 |

## 실행

```bash
cp .env.example .env      # 비밀번호·API 키 입력
docker compose up -d --build
```

Airflow 로그인 계정은 `.env`의 `AIRFLOW_ADMIN_USER` / `AIRFLOW_ADMIN_PASSWORD`.

계정·DB 비밀번호는 볼륨을 처음 만들 때만 반영된다. 이후 `.env`에서 바꾸면 `docker compose down -v`로 초기화하거나 DB에서 직접 변경해야 한다.

커넥션·Variable은 UI가 아니라 `.env` → 환경변수(`AIRFLOW_CONN_*`, `AIRFLOW_VAR_*`)로 등록한다. 볼륨을 초기화해도 유지되고, UI 목록에는 보이지 않는다.

## DAG

| DAG | 주기 | 역할 |
|---|---|---|
| ev01_traffic_collect | 30분 | 도로소통 수집·시간대 집계 |
| ev02_registration_monthly | 매월 1일 | 등록현황 스냅샷 (api / file) |
| ev03_mart_integration | 매일 06:00 또는 Asset | 지표·분류·마트 게시 |
| ev10_master_refresh | 수동 | 링크·경계 마스터 버전 |
| ev11_reprocess | 수동 | 재처리 요청 |
| ev12_quality_monitor | 매일 08:00 | 실행 상태 × 데이터 상태 리포트 |
| ev13_retention_cleanup | 매주 일 03:00 | 조건부 보존 정리 (기본 dry-run) |

## DBeaver 연결

| 연결 | Host | Port | Database | 계정 |
|---|---|---|---|---|
| 분석 DB | localhost | 5432 | `EV_DB_NAME` | `EV_DB_USER` / `EV_DB_PASSWORD` |
| Airflow 메타데이터 | localhost | 5431 | `POSTGRES_DB` | `POSTGRES_USER` / `POSTGRES_PASSWORD` |

메타데이터 DB에서는 `dag_run`, `task_instance`로 실행 이력을 직접 조회할 수 있다. 쓰기는 하지 않는다.

## 참고

- RFP 원문은 저장소에 포함하지 않음
- 공식 `postgis/postgis` 이미지는 amd64 전용이라 `postgres:16`에 PostGIS를 설치해 빌드
- Rshiny는 읽기 전용 계정 `rshiny_reader`로 `mart`, `ops`만 조회
