-- 팀장 보고 권한 규칙 검증 (work_notes_test 이후 실행, 같은 사용자 사용)
\set ON_ERROR_STOP 1
\o /dev/null

create function pg_temp.expect_fail(q text, label text) returns void language plpgsql as $$
begin
  execute q;
  raise exception '실패해야 함: %', label;
exception when insufficient_privilege or check_violation or invalid_parameter_value then
  null;
end $$;

create function pg_temp.affected(q text) returns int language plpgsql as $$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end $$;

set role authenticated;

-- 운영1: 보고 작성, 알림 선점은 1회만
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
insert into public.reports (target, body, base_month) values ('region:1168058000', '현장 확인 결과 진입로 협소', '202609');
do $$ begin
  assert public.claim_report_notify((select max(id) from public.reports)), '첫 알림 선점';
  assert not public.claim_report_notify((select max(id) from public.reports)), '두 번째 알림 차단';
end $$;
select pg_temp.expect_fail($q$insert into public.reports (target, body, read_at) values ('page:/quality', 'x', now())$q$, '읽음 위조');
select pg_temp.expect_fail($q$insert into public.reports (target, body, author) values ('page:/quality', 'x', '00000000-0000-0000-0000-000000000013')$q$, '다른 사람 명의');
select pg_temp.expect_fail($q$insert into public.reports (target, body) values ('page:/quality', '  ')$q$, '빈 보고');
select pg_temp.expect_fail($q$select public.mark_report_read((select max(id) from public.reports))$q$, '운영자 읽음 처리');
select pg_temp.expect_fail($q$update public.reports set read_at = now()$q$, '직접 수정');

-- 운영2: 남의 보고 조회·삭제·알림 불가
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000013';
do $$ begin
  assert (select count(*) from public.reports) = 0, '남의 보고 조회';
  assert pg_temp.affected($q$delete from public.reports$q$) = 0, '남의 보고 삭제';
end $$;

-- 열람자: 작성 불가
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000014';
select pg_temp.expect_fail($q$insert into public.reports (target, body) values ('page:/quality', 'x')$q$, '열람자 보고');

-- 팀장: 전체 조회·읽음 처리
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$ begin
  assert (select count(*) from public.reports) = 1, '팀장 전체 조회';
  assert public.mark_report_read((select max(id) from public.reports)) is not null, '읽음 처리';
  assert (select read_by from public.reports) = '00000000-0000-0000-0000-000000000011', '확인자 기록';
end $$;

-- 운영1: 읽힌 보고는 삭제 불가
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
do $$ begin
  assert (select count(*) from public.reports where read_at is not null) = 1, '본인 보고 읽음 확인';
  assert pg_temp.affected($q$delete from public.reports$q$) = 0, '읽힌 보고 삭제';
end $$;

reset role;
set role anon;
select pg_temp.expect_fail($q$select count(*) from public.reports$q$, '비로그인 보고 조회');
reset role;
\o
\echo 'reports 권한 검증 통과'
