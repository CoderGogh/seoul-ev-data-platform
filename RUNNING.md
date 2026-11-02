# 실행·운영 가이드

서울 전동화 입지 인사이트 플랫폼을 로컬에서 띄우고 운영하기 위한 문서입니다.
프로젝트 개요와 결과는 [README.md](./README.md), 설계는 [docs/dag_design.md](./docs/dag_design.md), 형상 관리 규칙은 [CONTRIBUTING.md](./CONTRIBUTING.md)를 참고하세요.

---

## 1. 사전 준비

- **Docker / Docker Compose** 설치
- **서울시 공공데이터 API 키** (도로소통정보·등록현황 수집용)
- **GitHub fine-grained 토큰** (웹 데이터 자동 게시용, 선택). Settings → Developer settings → Fine-grained tokens → 이 저장소만, Repository permissions에서 Contents: Read and write만 → `.env`의 `GITHUB_WEB_DATA_TOKEN`. 없으면 ev14만 실패하고 웹은 배포 스냅샷 사용
- **공공데이터포털 API 키** (충전소 정보 수집용, [15076352](https://www.data.go.kr/data/15076352/openapi.do) 활용신청 → `.env`의 `EV_CHARGER_API_KEY`). 없으면 ev04만 실패

## 2. 빠른 시작

```bash
cp .env.example .env      # 비밀번호·API 키 입력
docker compose up -d --build
```

띄우고 나면 아래로 접속합니다.

- **Airflow UI** — http://localhost:8080
  로그인 계정은 `.env`의 `AIRFLOW_ADMIN_USER` / `AIRFLOW_ADMIN_PASSWORD`
- **Flower (워커 모니터링)** — http://localhost:5555
- **Rshiny 대시보드** — http://localhost:3838

## 3. 서비스 구성

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

## 4. DAG 목록

| DAG | 주기 | 역할 |
|---|---|---|
| ev01_traffic_collect | 30분 | 도로소통 수집·시간대 집계 |
| ev02_registration_monthly | 매월 1일 | 등록현황 스냅샷 (api / file) |
| ev03_mart_integration | 매일 06:00 또는 Asset | 지표·분류·마트 게시 |
| ev04_charger_daily | 매일 05:00 | 충전기 공급 스냅샷 (이력 관리) |
| ev10_master_refresh | 수동 | 링크·경계 마스터 버전 |
| ev11_reprocess | 수동 | 재처리 요청 |
| ev12_quality_monitor | 매일 08:00 | 실행 상태 × 데이터 상태 리포트 |
| ev13_retention_cleanup | 매주 일 03:00 | 조건부 보존 정리 (기본 dry-run) |
| ev14_web_publish | 게시·공급 변경 시, 매일 07:10 | 웹 데이터를 `web-data` 브랜치에 게시 |

## 5. DB 접속 (DBeaver)

| 연결 | Host | Port | Database | 계정 |
|---|---|---|---|---|
| 분석 DB | localhost | 5432 | `EV_DB_NAME` | `EV_DB_USER` / `EV_DB_PASSWORD` |
| Airflow 메타데이터 | localhost | 5431 | `POSTGRES_DB` | `POSTGRES_USER` / `POSTGRES_PASSWORD` |

메타데이터 DB에서는 `dag_run`, `task_instance`로 실행 이력을 조회할 수 있습니다. (조회 전용, 쓰기 금지)

## 6. 웹 화면

결과 화면(https://seoul-ev-insight.vercel.app)은 DB에 직접 붙지 않고, `web/public/data/*.json` 스냅샷만 읽는 정적 사이트입니다. main에 병합되면 Vercel이 자동으로 다시 배포합니다.

**데이터 갱신**: Airflow가 돌고 있으면 ev14가 게시 직후 `web-data` 브랜치에 자동으로 올리고, 웹은 열 때 그걸 읽습니다. 아래 수동 방법은 배포 스냅샷(대체용)을 갱신할 때만 씁니다.

**배포 스냅샷 갱신** (수동)

```bash
docker compose up -d postgis      # 수집 재개 없이 DB만
./scripts/export_web_data.sh      # files/sqls/web/*.sql → web/public/data/*.json
python3 scripts/export_progress.py  # 로드맵 이슈·병합 PR → progress.json (gh 로그인 필요)
docker compose down               # -v 금지
```

바뀐 JSON을 브랜치에서 커밋하고 PR로 병합합니다. 모든 화면 위에 원천별 기준일과 경과 일수가 나오고, 기준을 넘으면 주의·오래됨 색으로 바뀝니다 (`web/src/freshness.ts`). 개발 진행 화면은 열 때 GitHub 공개 API로 이슈 상태를 다시 받아와서, 스냅샷이 오래돼도 완료 여부는 최신으로 보입니다.

**로컬 실행**

```bash
cd web
npm ci
npm run dev                       # http://localhost:5173
npm test                          # 단위 테스트 (데이터 신선도 규칙)
```

## 7. 테스트

```bash
pytest -q tests --ignore=tests/test_dag_integrity.py   # 단위 (DB 테스트는 건너뜀)
pytest -q tests/test_dag_integrity.py                  # DAG 정책
docker compose up -d postgis && ./scripts/test_db.sh   # DB 통합 (테스트 전용 ev_test 재생성)
```

운영 DB(`EV_DB_NAME`)는 건드리지 않습니다. Airflow 패키지가 설치된 가상환경에서 실행합니다.

---

## 알아둘 점

- **비밀번호·계정 변경** — 계정·DB 비밀번호는 볼륨을 처음 만들 때만 반영됩니다. 이후 `.env`에서 바꾸려면 `docker compose down -v`로 볼륨을 초기화하거나 DB에서 직접 변경하세요.
- **커넥션·Variable 등록** — UI가 아니라 `.env` → 환경변수(`AIRFLOW_CONN_*`, `AIRFLOW_VAR_*`)로 등록합니다. 볼륨을 초기화해도 유지되지만 UI 목록에는 보이지 않습니다.
- **PostGIS 이미지** — 공식 `postgis/postgis` 이미지는 amd64 전용이라, `postgres:16`에 PostGIS를 설치해 빌드합니다.
- **Rshiny 권한** — 읽기 전용 계정 `rshiny_reader`로 `mart`, `ops` 스키마만 조회합니다.
- **RFP 원문** — 저장소에는 포함하지 않습니다.