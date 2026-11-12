-- 분석 DB 백업 외부 보관용 비공개 버킷 (ev16 업로드)
-- 정책 없음 = 로그인 사용자·익명 접근 불가, secret 키(서버)만 읽기·쓰기
insert into storage.buckets (id, name, public, file_size_limit)
values ('db-backups', 'db-backups', false, 52428800)
on conflict (id) do nothing;
