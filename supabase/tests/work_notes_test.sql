-- 담당·메모 권한 규칙 검증 (실패 시 예외로 중단)
\set ON_ERROR_STOP 1
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-000000000011', 'lead@x.com', '{"name":"팀장"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-000000000012', 'op1@x.com', '{"name":"운영1"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-000000000013', 'op2@x.com', '{"name":"운영2"}', '{"provider":"kakao"}'),
  ('00000000-0000-0000-0000-000000000014', 'view@x.com', '{"name":"열람"}', '{"provider":"kakao"}');

update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000011';
update public.profiles set role = 'operator' where id in ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013');
update public.profiles set role = 'viewer' where id = '00000000-0000-0000-0000-000000000014';

-- 실패 기대 실행 (권한·검사 위반)
create function pg_temp.expect_fail(q text, label text) returns void language plpgsql as $$
begin
  execute q;
  raise exception '실패해야 함: %', label;
exception when insufficient_privilege or check_violation or invalid_parameter_value then
  null;
end $$;

-- 영향 행 수
create function pg_temp.affected(q text) returns int language plpgsql as $$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end $$;

set role authenticated;

-- 운영1: 담당 지정·메모 작성
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
insert into public.work_items (target, assignee, status, base_month)
  values ('region:1168058000', '00000000-0000-0000-0000-000000000013', 'doing', '202609');
insert into public.notes (target, body, base_month) values ('region:1168058000', '현장 조사 일정 잡음', '202609');
do $$ begin
  assert (select updated_by from public.work_items where target = 'region:1168058000') = '00000000-0000-0000-0000-000000000012', '변경자 기록';
  assert (select author from public.notes where target = 'region:1168058000') = '00000000-0000-0000-0000-000000000012', '작성자 기본값';
  assert (select count(*) from public.list_staff()) >= 3, '담당자 후보 조회';
  assert not exists (select 1 from public.list_staff() where role not in ('operator', 'admin')), '후보는 운영 이상만';
end $$;
select pg_temp.expect_fail($q$insert into public.notes (target, body, author) values ('page:/quality', '남의 이름', '00000000-0000-0000-0000-000000000013')$q$, '다른 사람 명의 메모');
select pg_temp.expect_fail($q$insert into public.work_items (target, assignee) values ('page:/quality', '00000000-0000-0000-0000-000000000014')$q$, '열람자 담당 지정');
select pg_temp.expect_fail($q$insert into public.notes (target, body) values ('page:/quality', '   ')$q$, '빈 메모');
select pg_temp.expect_fail($q$insert into public.notes (target, body) values ('bad target', 'x')$q$, '대상 형식');

-- 변경자 위조 불가 (트리거가 덮어씀)
update public.work_items set status = 'hold', updated_by = '00000000-0000-0000-0000-000000000011' where target = 'region:1168058000';
do $$ begin
  assert (select updated_by from public.work_items where target = 'region:1168058000') = '00000000-0000-0000-0000-000000000012', '변경자 위조 차단';
end $$;

-- 운영2: 남의 메모 삭제 불가, 담당 삭제 불가
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000013';
do $$ begin
  assert pg_temp.affected($q$delete from public.notes where target = 'region:1168058000'$q$) = 0, '남의 메모 삭제';
  assert pg_temp.affected($q$delete from public.work_items where target = 'region:1168058000'$q$) = 0, '운영자 담당 삭제';
end $$;
insert into public.notes (target, body) values ('region:1168058000', '확인함');
do $$ begin
  assert pg_temp.affected($q$delete from public.notes where body = '확인함'$q$) = 1, '본인 메모 삭제';
end $$;

-- 열람자: 조회·작성 불가, 이름 목록 비어 있음
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000014';
do $$ begin
  assert (select count(*) from public.notes) = 0, '열람자 메모 조회';
  assert (select count(*) from public.work_items) = 0, '열람자 담당 조회';
  assert (select count(*) from public.list_staff()) = 0, '열람자 담당자 목록';
end $$;
select pg_temp.expect_fail($q$insert into public.notes (target, body) values ('page:/quality', 'x')$q$, '열람자 메모 작성');

-- 팀장: 남의 메모·담당 삭제 가능
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ begin
  assert pg_temp.affected($q$delete from public.notes where target = 'region:1168058000'$q$) = 1, '팀장 메모 삭제';
  assert pg_temp.affected($q$delete from public.work_items where target = 'region:1168058000'$q$) = 1, '팀장 담당 삭제';
end $$;

-- 비로그인
reset role;
set role anon;
select pg_temp.expect_fail($q$select count(*) from public.notes$q$, '비로그인 메모 조회');
select pg_temp.expect_fail($q$select public.list_staff()$q$, '비로그인 담당자 목록');
reset role;
