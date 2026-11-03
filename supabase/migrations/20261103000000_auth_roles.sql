-- 웹 로그인 사용자 권한 (Supabase Auth: Google·Kakao)
-- 역할: pending(가입 직후) < viewer < operator(운영 화면) < admin(권한 관리)
-- 최고 관리자(is_super)는 SQL 편집기에서 직접 지정 (docs/auth_setup.md)

create type public.app_role as enum ('pending', 'viewer', 'operator', 'admin');

-- 사용자 프로필
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  avatar_url text,
  provider text,
  role public.app_role not null default 'pending',
  is_super boolean not null default false,
  created_at timestamptz not null default now(),
  role_updated_at timestamptz,
  role_updated_by uuid references auth.users (id) on delete set null
);

alter table public.profiles enable row level security;

-- 직접 쓰기 차단 (가입 트리거·set_user_role로만 변경)
revoke insert, update, delete on public.profiles from anon, authenticated;

-- 가입 시 프로필 생성 (항상 pending)
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, avatar_url, provider)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_app_meta_data ->> 'provider'
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 현재 사용자 관리자 여부 (RLS 재귀 방지용 definer)
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- 조회: 본인 또는 관리자
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

-- 역할 변경 (관리자 전용, admin 부여·회수는 최고 관리자만)
create function public.set_user_role(target uuid, new_role public.app_role)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  cur public.profiles;
  result public.profiles;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if me.id is null or me.role <> 'admin' then
    raise exception '권한 없음' using errcode = '42501';
  end if;

  select * into cur from public.profiles where id = target;
  if cur.id is null then
    raise exception '사용자 없음' using errcode = 'P0002';
  end if;
  if cur.id = me.id then
    raise exception '본인 역할 변경 불가' using errcode = '42501';
  end if;
  if cur.is_super then
    raise exception '최고 관리자 변경 불가' using errcode = '42501';
  end if;
  if (new_role = 'admin' or cur.role = 'admin') and not me.is_super then
    raise exception '관리자 지정은 최고 관리자만 가능' using errcode = '42501';
  end if;

  update public.profiles
  set role = new_role, role_updated_at = now(), role_updated_by = me.id
  where id = target
  returning * into result;
  return result;
end;
$$;

revoke execute on function public.set_user_role(uuid, public.app_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;
