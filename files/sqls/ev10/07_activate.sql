-- 같은 유형의 기존 활성 버전 은퇴 후 신규 활성 (단일 트랜잭션)
-- 파라미터: boundary_ver, link_ver
UPDATE core.master_version SET status = 'retired'
WHERE status = 'active'
  AND ((master_type = 'boundary' AND version <> %(boundary_ver)s) OR (master_type = 'link' AND version <> %(link_ver)s));

UPDATE core.master_version SET status = 'active', activated_at = now()
WHERE (master_type, version) IN (('boundary', %(boundary_ver)s), ('link', %(link_ver)s));
