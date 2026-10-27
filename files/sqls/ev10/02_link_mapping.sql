-- 서비스링크 ↔ 표준링크 매핑 적재 (xlsx → JSON 변환본)
-- 파라미터: mapping_ver, mapping_file
DELETE FROM core.service_link_map WHERE mapping_ver = %(mapping_ver)s;
INSERT INTO core.service_link_map (mapping_ver, row_no, service_link_id, std_link_seq, std_link_id)
SELECT %(mapping_ver)s, t.n, t.r->>0, (t.r->>1)::int, NULLIF(t.r->>2, '')
FROM jsonb_array_elements(pg_read_file(%(mapping_file)s)::jsonb->'rows') WITH ORDINALITY AS t(r, n);
