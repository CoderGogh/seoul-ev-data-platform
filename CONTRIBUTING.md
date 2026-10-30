# 형상 관리 규칙

## 브랜치

`main`은 보호 브랜치다. 직접 push하지 않고 PR로만 병합한다.

| 접두어 | 용도 | 예 |
|---|---|---|
| `feat/` | 기능, DAG 추가·수정 | `feat/ev02-registration-dag` |
| `fix/` | 버그 수정 | `fix/ev01-chunk-retry` |
| `hotfix/` | 운영 중 긴급 수정 | `hotfix/api-key-expired` |
| `ci/` | CI 설정 | `ci/github-actions` |
| `build/` | 이미지·의존성 | `build/airflow-openpyxl` |
| `docs/` | 문서 | `docs/git-convention` |
| `refactor/`, `test/`, `chore/` | 그 외 | `test/dag-policy` |
| `release/` | 릴리즈 준비 | `release/v0.1.0` |

- 이름은 소문자와 하이픈만 쓴다.
- 한 브랜치에는 DAG 하나 또는 기능 하나만 담는다.

## 커밋

- 한 줄, `type: 설명` 형식
  - type: `feat` `fix` `build` `chore` `ci` `docs` `style` `refactor` `test` `release`
  - 예: `feat: ev02 등록현황 기준월 결정 Task 추가`
- 파일이나 관심사 단위로 잘게 나눈다.

## PR

- 템플릿(`.github/pull_request_template.md`)을 채운다.
- 제목은 커밋과 같은 `type: 설명` 형식으로 쓴다.
- CI(lint → test → validate_dag)가 통과해야 병합할 수 있다.
- `web/`을 바꾸면 웹 빌드(`web_build`)도 통과해야 한다.
- 병합은 merge commit 방식이다. 브랜치의 작은 커밋 이력을 그대로 남긴다.
- 병합 후 브랜치는 삭제한다.

## DB 변경

- 스키마 변경은 `files/sqls/ddl/`에 번호 순서로 추가한다. 기존 파일은 고치지 않고 다음 번호 파일로 변경한다 (운영 DB에 이미 적용된 순서를 보존).
- 모든 DDL은 `IF NOT EXISTS` 등으로 재실행해도 안전하게 쓴다.
- PR 템플릿의 "DB 변경 사항"에 체크하고 적용 방법을 적는다.

## 릴리즈

- `main` 병합 후 배포 단위로 `vMAJOR.MINOR.PATCH` 태그를 붙인다.
- 마스터·임계값 버전은 DB(`core.master_version`, `ops.threshold_version`)에 남는다. 배포 태그와 함께 보면 어떤 코드와 데이터로 결과가 나왔는지 추적할 수 있다.

## 비밀값

- `.env`, API 키, 비밀번호는 커밋하지 않는다. `.env.example`에 항목만 둔다.
- CI·배포에서는 CI 변수(masked, protected)로 주입한다.
