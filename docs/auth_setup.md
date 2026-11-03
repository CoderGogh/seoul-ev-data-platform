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
2. SQL Editor에서 `supabase/migrations/20261103000000_auth_roles.sql` 실행
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

## 검증

```bash
scripts/test_auth_sql.sh   # 일회용 postgres 컨테이너에서 권한 규칙 검사 (CI validate_ddl에도 포함)
cd web && npm test         # 역할 판정·이동 경로 검사
```
