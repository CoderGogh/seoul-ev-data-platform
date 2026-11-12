-- 화면별 담당자·진행 상태·메모 (운영 이상 조회·작성, 팀장 = admin)
-- 대상 키: region:<행정동 코드> 또는 page:<화면 경로>
-- 개인정보: 담당자·작성자는 profiles 참조만, 이메일은 노출하지 않음 (list_staff)

create type public.work_status as enum ('todo', 'doing', 'done', 'hold');

-- 현재 사용자 운영 이상 여부 (RLS 재귀 방지용 definer)
create function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('operator', 'admin')
  );
$$;

revoke execute on function public.is_operator() from public, anon;
grant execute on function public.is_operator() to authenticated;

-- 담당자 지정·진행 상태 (대상당 1행)
create table public.work_items (
  target text primary key
    check (target ~ '^(region|page):[A-Za-z0-9/_-]{1,64}$'),
  assignee uuid references public.profiles (id) on delete set null,
  status public.work_status not null default 'todo',
  base_month text check (base_month ~ '^[0-9]{6}$'),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 메모 (수정 없음, 삭제만)
create table public.notes (
  id bigint generated always as identity primary key,
  target text not null
    check (target ~ '^(region|page):[A-Za-z0-9/_-]{1,64}$'),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  base_month text check (base_month ~ '^[0-9]{6}$'),
  author uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index notes_target_idx on public.notes (target, created_at desc);
create index work_items_assignee_idx on public.work_items (assignee);

-- 변경자·시각 강제, 담당자는 운영 이상만
create function public.work_items_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee is not null and not exists (
    select 1 from public.profiles where id = new.assignee and role in ('operator', 'admin')
  ) then
    raise exception '담당자는 운영 이상만' using errcode = '22023';
  end if;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.work_items_stamp() from public, anon, authenticated;

create trigger work_items_stamp
  before insert or update on public.work_items
  for each row execute function public.work_items_stamp();

alter table public.work_items enable row level security;
alter table public.notes enable row level security;

revoke all on public.work_items, public.notes from anon, authenticated;
grant select, insert, update, delete on public.work_items to authenticated;
grant select, insert, delete on public.notes to authenticated;

-- 담당·상태: 운영 이상 조회·지정, 삭제는 팀장
create policy work_items_select on public.work_items
  for select to authenticated using (public.is_operator());
create policy work_items_insert on public.work_items
  for insert to authenticated with check (public.is_operator());
create policy work_items_update on public.work_items
  for update to authenticated using (public.is_operator()) with check (public.is_operator());
create policy work_items_delete on public.work_items
  for delete to authenticated using (public.is_admin());

-- 메모: 운영 이상 조회·작성(본인 명의), 삭제는 본인 또는 팀장
create policy notes_select on public.notes
  for select to authenticated using (public.is_operator());
create policy notes_insert on public.notes
  for insert to authenticated with check (public.is_operator() and author = (select auth.uid()));
create policy notes_delete on public.notes
  for delete to authenticated using (author = (select auth.uid()) or public.is_admin());

-- 담당자 후보·작성자 이름 (운영 이상에게만, 이메일 제외)
create function public.list_staff()
returns table (id uuid, name text, role public.app_role)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(nullif(btrim(p.name), ''), '이름 없음'), p.role
  from public.profiles p
  where public.is_operator() and p.role in ('operator', 'admin')
  order by p.role desc, p.name;
$$;

revoke execute on function public.list_staff() from public, anon;
grant execute on function public.list_staff() to authenticated;
