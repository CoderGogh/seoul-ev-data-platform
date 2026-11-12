-- 테스트용 Supabase 환경 흉내 (auth 스키마·역할)
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Storage 버킷 목록 (백업 버킷 마이그레이션용)
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint);
