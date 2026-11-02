-- 정제·행정동 귀속 (활성 경계, 점 포함). 삭제 표시(delYn=Y)는 제외 → 이력 종료 대상
-- 급속: 출력 50kW 이상 (타입 코드와 실제 출력 불일치 있음, 예: 07 AC3상 7kW), 출력 없으면 타입 코드
-- 귀속 구 ≠ 요청 구: sgg_mismatch (원천 좌표 오류, 공급 집계 제외)
-- 파라미터: run_id
DELETE FROM staging.charger_norm WHERE run_id = %(run_id)s;

INSERT INTO staging.charger_norm (
    run_id, stat_id, chger_id, sgg_cd, stat_nm, chger_type, is_fast, output_kw, busi_id, busi_nm,
    kind, kind_detail, limit_yn, parking_free, addr, geom, boundary_ver, adm_cd, assign_status, attr_hash)
WITH b AS (SELECT version FROM core.master_version WHERE master_type = 'boundary' AND status = 'active'),
src AS (
    SELECT c.run_id, c.stat_id, c.chger_id, c.sgg_cd,
           nullif(btrim(c.payload->>'statNm'), '') AS stat_nm,
           nullif(btrim(c.payload->>'chgerType'), '') AS chger_type,
           CASE WHEN btrim(c.payload->>'output') ~ '^[0-9]+(\.[0-9]+)?$' THEN (c.payload->>'output')::numeric END AS output_kw,
           nullif(btrim(c.payload->>'busiId'), '') AS busi_id,
           nullif(btrim(c.payload->>'busiNm'), '') AS busi_nm,
           nullif(btrim(c.payload->>'kind'), '') AS kind,
           nullif(btrim(c.payload->>'kindDetail'), '') AS kind_detail,
           nullif(upper(btrim(c.payload->>'limitYn')), '') AS limit_yn,
           nullif(upper(btrim(c.payload->>'parkingFree')), '') AS parking_free,
           nullif(btrim(c.payload->>'addr'), '') AS addr,
           ST_Transform(ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326), 5186) AS geom
    FROM staging.v_charger_check c
    WHERE c.run_id = %(run_id)s AND c.reason_code IS NULL AND NOT c.is_deleted
)
SELECT s.run_id, s.stat_id, s.chger_id, s.sgg_cd, s.stat_nm, s.chger_type,
       CASE WHEN s.output_kw IS NOT NULL THEN s.output_kw >= 50 ELSE t.is_fast END, s.output_kw, s.busi_id,
       s.busi_nm, s.kind, s.kind_detail, s.limit_yn, s.parking_free, s.addr, s.geom, b.version, a.adm_cd,
       CASE WHEN a.adm_cd IS NULL THEN 'outside'
            WHEN left(a.adm_cd, 5) <> s.sgg_cd THEN 'sgg_mismatch' ELSE 'assigned' END,
       md5(concat_ws('|', s.sgg_cd, s.stat_nm, s.chger_type, s.output_kw, s.busi_id, s.busi_nm, s.kind,
                     s.kind_detail, s.limit_yn, s.parking_free, s.addr, ST_AsText(s.geom), b.version, a.adm_cd))
FROM src s
CROSS JOIN b
LEFT JOIN core.charger_type t ON t.chger_type = s.chger_type
LEFT JOIN LATERAL (
    SELECT d.adm_cd FROM core.admdong d
    WHERE d.boundary_ver = b.version AND ST_Contains(d.geom, s.geom)
    ORDER BY d.adm_cd LIMIT 1  -- 경계선 위 점은 코드 순 첫 동
) a ON true;
