-- 권한 규칙 검증 (실패 시 예외로 중단)
\set ON_ERROR_STOP 1
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'boss@x.com', '{"full_name":"Boss"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-000000000002', 'adm@x.com', '{"name":"Adm"}', '{"provider":"kakao"}'),
  ('00000000-0000-0000-0000-000000000003', 'u@x.com', '{}', '{"provider":"kakao"}');

-- 실패 기대 실행
create function pg_temp.expect_fail(q text, label text) returns void language plpgsql as $$
begin
  execute q;
  raise exception '실패해야 함: %', label;
exception when insufficient_privilege or no_data_found then
  null;
end $$;

-- 가입 트리거: 항상 pending
do $$ begin
  assert (select count(*) from public.profiles where role = 'pending') = 3, '가입 시 pending';
  assert (select name from public.profiles where email = 'boss@x.com') = 'Boss', 'full_name 반영';
  assert (select provider from public.profiles where email = 'u@x.com') = 'kakao', 'provider 반영';
end $$;

-- 최고 관리자 지정 (부트스트랩)
update public.profiles set role = 'admin', is_super = true where email = 'boss@x.com';

set role authenticated;

-- 일반 사용자
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$ begin assert (select count(*) from public.profiles) = 1, '본인만 조회'; end $$;
select pg_temp.expect_fail($q$update public.profiles set role = 'admin'$q$, '직접 수정');
select pg_temp.expect_fail($q$select public.set_user_role('00000000-0000-0000-0000-000000000003', 'admin')$q$, '비관리자 변경');

-- 최고 관리자
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin assert (select count(*) from public.profiles) = 3, '관리자 전체 조회'; end $$;
select public.set_user_role('00000000-0000-0000-0000-000000000002', 'admin');
select public.set_user_role('00000000-0000-0000-0000-000000000003', 'operator');
select pg_temp.expect_fail($q$select public.set_user_role('00000000-0000-0000-0000-000000000001', 'viewer')$q$, '본인 변경');
select pg_temp.expect_fail($q$select public.set_user_role('00000000-0000-0000-0000-0000000000ff', 'viewer')$q$, '없는 사용자');

-- 일반 관리자
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select public.set_user_role('00000000-0000-0000-0000-000000000003', 'viewer');
select pg_temp.expect_fail($q$select public.set_user_role('00000000-0000-0000-0000-000000000003', 'admin')$q$, 'admin 부여');
select pg_temp.expect_fail($q$select public.set_user_role('00000000-0000-0000-0000-000000000001', 'pending')$q$, '최고 관리자 변경');

-- 비로그인
reset role;
set role anon;
select pg_temp.expect_fail($q$select count(*) from public.profiles$q$, '비로그인 조회');

reset role;
do $$ begin
  assert (select role from public.profiles where email = 'u@x.com') = 'viewer', '최종 역할';
  assert (select role_updated_by from public.profiles where email = 'u@x.com') = '00000000-0000-0000-0000-000000000002', '변경자 기록';
end $$;

\o
\echo 권한 규칙 테스트 통과
