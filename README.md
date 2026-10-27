# 서울 전동화 입지 인사이트 플랫폼

월 단위 전기차 등록현황과 실시간 도로소통정보를 각자 주기로 수집하고, 행정동 단위로 맞춰 검토 후보(A·B·C)를 분류하는 Airflow 파이프라인.

설계는 [docs/dag_design.md](docs/dag_design.md) 참고.

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
| rshiny | 분류 결과 시각화 | http://localhost:3838 |

## 실행

```bash
cp .env.example .env      # 비밀번호·API 키 입력
docker compose up -d --build
```

Airflow 로그인 계정은 `.env`의 `AIRFLOW_ADMIN_USER` / `AIRFLOW_ADMIN_PASSWORD`.

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
