# 웹 로그인·권한 설정

웹 화면(Vercel)에 Google·카카오 로그인을 붙이고 역할별로 화면을 연다. 인증과 역할 저장은 Supabase(Auth + Postgres)가 맡고, 웹은 정적 배포 그대로 둔다.

## 역할

| 역할 | 볼 수 있는 화면 |
|---|---|
| 비로그인 | 대시보드, 지역·지표 분석 |
| `pending` 승인 대기 | 비로그인과 같음 (가입 직후 기본값) |
| `viewer` 조회 | 분석 화면 |
| `operator` 운영 | + 데이터 품질·파이프라인 실행·개발 진행·데이터 버전 |
| `admin` 관리자 | + 사용자 권한 (`/admin/users`) |

- 최고 관리자(`is_super`)는 1명이고 SQL로만 지정한다. 화면에서는 바꿀 수 없다
- `admin` 부여·회수는 최고 관리자만, 나머지 역할은 관리자 누구나 바꾼다
- 본인 역할은 바꿀 수 없다
- 규칙은 DB 함수 `set_user_role`에서 검사한다. 화면 검사는 표시용
- 운영 화면 잠금은 화면만 막는다. 원본 JSON(`web-data` 브랜치)은 지금도 공개

## 설정 순서

### 1. Supabase 프로젝트

1. supabase.com에서 새 프로젝트 생성 (리전 Northeast Asia (Seoul))
2. SQL Editor에서 `supabase/migrations/` 파일을 이름 순서대로 실행
   - `20261103000000_auth_roles.sql` 역할
   - `20261112000000_work_notes.sql` 담당·메모
   - `20261113010000_reports.sql` 팀장 보고
3. Authentication → URL Configuration
   - Site URL: `https://seoul-ev-insight.vercel.app`
   - Redirect URLs: `https://seoul-ev-insight.vercel.app/**`, `http://localhost:5173/**`

콜백 주소는 `https://<project-ref>.supabase.co/auth/v1/callback`. 아래 두 곳에 똑같이 넣는다.

### 2. Google

1. Google Cloud Console → Google Auth Platform → 브랜딩(동의 화면) 작성, 대상 External
2. 클라이언트 → OAuth 클라이언트 만들기 → 웹 애플리케이션
   - 승인된 JavaScript 원본: `https://seoul-ev-insight.vercel.app`, `http://localhost:5173`
   - 승인된 리디렉션 URI: Supabase 콜백 주소
3. 클라이언트 ID·보안 비밀 → Supabase Authentication → Sign In / Providers → Google에 입력·활성화

### 3. 카카오

1. developers.kakao.com → 앱 생성
2. 카카오 로그인 활성화, Redirect URI에 Supabase 콜백 주소 등록
3. 동의항목: 닉네임, 프로필 사진, 카카오계정(이메일)
   - 이메일은 비즈 앱 전환이 필요하다. 못 받으면 Supabase Kakao 설정에서 `Allow users without an email` 켬
4. 보안에서 Client Secret 생성·사용 설정
5. REST API 키(Client ID)·Client Secret → Supabase Providers → Kakao에 입력·활성화

### 4. 웹 환경변수

Supabase Project Settings → API Keys의 Project URL과 publishable 키를 쓴다. publishable 키는 공개용이고 보안은 RLS가 맡는다. secret 키는 웹에 넣지 않는다.

- Vercel → Settings → Environment Variables (Production·Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` → 재배포
- 로컬: `web/.env.example`을 `web/.env.local`로 복사해 채움

환경변수가 없으면 로그인 버튼이 숨겨지고 운영 화면은 잠긴다.

### 5. 최고 관리자 지정

본인 Google 계정으로 한 번 로그인한 뒤 SQL Editor에서 실행한다. 이메일은 저장소에 커밋하지 않는다.

```sql
update public.profiles set role = 'admin', is_super = true where email = '<내 이메일>';
```

새로고침하면 사이드바에 `관리 → 사용자 권한`이 생긴다.

## 담당·메모 (오른쪽 바)

| 기능 | 운영 | 팀장(`admin`) |
|---|---|---|
| 담당자 지정·진행 상태 변경 | O | O |
| 메모 조회·작성 | O | O |
| 메모 삭제 | 본인 것만 | 전부 |
| 담당 기록 삭제 | X | O |

- 대상은 동(`region:<행정동 코드>`) 또는 화면(`page:<경로>`) 단위
- 메모에 작성 당시 등록 기준월을 같이 저장. 다시 게시되면 메모에 `YYYY.MM 기준` 표시
- 담당자 후보는 `list_staff()`로 이름·역할만 받음 (이메일 미노출)
- 비로그인·조회 역할은 오른쪽 바에서 화면 알림만 봄
- 로컬 미리보기(`VITE_DEV_ROLE`)는 브라우저 메모리에 저장, 새로고침하면 초기화

## 팀장 보고

| 기능 | 운영 | 팀장(`admin`) |
|---|---|---|
| 보고 보내기 (오른쪽 바) | O | X |
| 보낸 보고·읽음 여부 (첫 화면) | 본인 것 | - |
| 받은 보고함·읽음 처리 (첫 화면) | X | O |
| 보고 삭제 | 읽기 전 본인 것 | 전부 |

- 읽음 처리는 `mark_report_read()`로만 (테이블 직접 수정 권한 없음)
- 보내면 Edge Function `report-notify`가 Slack에 한 번 알림. 보고당 1회는 `claim_report_notify()`로 보장
- Slack 실패·미설정이어도 보고는 저장되고 받은 보고함에 뜸

Slack 알림 켜기 (Supabase CLI, 한 번):

```bash
supabase login
supabase link --project-ref <project-ref>
supabase secrets set SLACK_REPORT_WEBHOOK_URL=<Slack Incoming Webhook URL> SITE_URL=https://seoul-ev-insight.vercel.app
supabase functions deploy report-notify --no-verify-jwt
```

`--no-verify-jwt`는 게이트웨이 검사만 끄는 것. 함수는 호출자 토큰으로 DB를 조회하므로 비로그인·남의 보고는 RLS에서 막힌다.

## 마이페이지 (`/me`)

사용자 메뉴·오른쪽 바 계정 칸에서 들어간다. 로그인 필요. 역할별로 보이는 구역이 다르다.

| 역할 | 구역 |
|---|---|
| 승인 대기 | 프로필, 승인 대기 안내 |
| 조회 | 프로필, 권한 안내, 지역·지표 분석 바로가기 |
| 운영 | 요약, 내 담당, 보낸 보고(읽기 전 삭제), 내가 남긴 메모, 데이터 운영 바로가기 |
| 관리자 | 요약, 받은 보고함(안 읽음·전체, 읽음 처리), 팀 담당 현황, 내 담당, 승인 대기 사용자 수, 운영·관리 바로가기 |

새 테이블 없음. 기존 RLS 그대로 (승인 대기 수는 관리자만 profiles 전체 조회 가능).

## 검증

```bash
scripts/test_auth_sql.sh   # 일회용 postgres 컨테이너에서 권한 규칙 검사 (CI validate_ddl에도 포함)
cd web && npm test         # 역할 판정·이동 경로 검사
```
