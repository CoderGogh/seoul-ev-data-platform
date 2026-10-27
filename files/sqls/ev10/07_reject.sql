-- 귀속률 기준 미달: 링크 버전 거부 (기존 활성 버전 유지)
-- 파라미터: link_ver
UPDATE core.master_version SET status = 'rejected'
WHERE master_type = 'link' AND version = %(link_ver)s AND status <> 'active';
