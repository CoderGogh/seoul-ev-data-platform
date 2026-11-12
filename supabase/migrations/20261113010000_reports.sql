-- 팀장 보고: 운영 이상이 화면·동 단위로 보고, 팀장(admin) 받은 보고함·읽음 처리, Slack 알림 1회
-- 개인정보: 작성자·확인자는 profiles 참조만, 이메일 미노출

create table public.reports (
  id bigint generated always as identity primary key,
  target text not null
    check (target ~ '^(region|page):[A-Za-z0-9/_-]{1,64}$'),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  base_month text check (base_month ~ '^[0-9]{6}$'),
  author uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  read_by uuid references public.profiles (id) on delete set null,
  notified_at timestamptz
);

create index reports_unread_idx on public.reports (created_at desc) where read_at is null;
create index reports_author_idx on public.reports (author, created_at desc);

alter table public.reports enable row level security;

revoke all on public.reports from anon, authenticated;
grant select, insert, delete on public.reports to authenticated;

-- 작성: 운영 이상, 본인 명의, 읽음·알림 칸은 비움
create policy reports_insert on public.reports
  for insert to authenticated
  with check (
    public.is_operator() and author = (select auth.uid())
    and read_at is null and read_by is null and notified_at is null
  );
-- 조회: 본인 보고 또는 팀장
create policy reports_select on public.reports
  for select to authenticated
  using (author = (select auth.uid()) or public.is_admin());
-- 삭제: 읽기 전 본인, 또는 팀장
create policy reports_delete on public.reports
  for delete to authenticated
  using ((author = (select auth.uid()) and read_at is null) or public.is_admin());

-- 읽음 처리 (팀장만, 이미 읽은 건 유지)
create function public.mark_report_read(report_id bigint)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  t timestamptz;
begin
  if not public.is_admin() then
    raise exception '팀장만 읽음 처리' using errcode = '42501';
  end if;
  update public.reports
     set read_at = coalesce(read_at, now()), read_by = coalesce(read_by, (select auth.uid()))
   where id = report_id
  returning read_at into t;
  return t;
end;
$$;

revoke execute on function public.mark_report_read(bigint) from public, anon;
grant execute on function public.mark_report_read(bigint) to authenticated;

-- Slack 알림 선점 (작성자 본인, 1회만 true) → Edge Function 중복 발송 방지
create function public.claim_report_notify(report_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.reports
     set notified_at = now()
   where id = report_id and author = (select auth.uid()) and notified_at is null;
  return found;
end;
$$;

revoke execute on function public.claim_report_notify(bigint) from public, anon;
grant execute on function public.claim_report_notify(bigint) to authenticated;
