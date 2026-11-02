-- 이력 반영 (load_log 와 같은 트랜잭션). 같은 수집일 재실행은 그날 반영분을 되돌린 뒤 다시 적용
-- 파라미터: run_id, snapshot_date, sgg_cds, load_id

-- 같은 날 반영분 되돌림
DELETE FROM core.charger WHERE valid_from = %(snapshot_date)s AND sgg_cd = ANY (%(sgg_cds)s);
UPDATE core.charger SET valid_to = NULL WHERE valid_to = %(snapshot_date)s AND sgg_cd = ANY (%(sgg_cds)s);

-- 변경·소멸 이력 종료 (대상 구에서 사라졌거나 속성이 바뀐 충전기, 구 이동 포함)
UPDATE core.charger c SET valid_to = %(snapshot_date)s
WHERE c.valid_to IS NULL
  AND (c.sgg_cd = ANY (%(sgg_cds)s)
       OR EXISTS (SELECT 1 FROM staging.charger_norm n
                  WHERE n.run_id = %(run_id)s AND n.stat_id = c.stat_id AND n.chger_id = c.chger_id))
  AND NOT EXISTS (SELECT 1 FROM staging.charger_norm n
                  WHERE n.run_id = %(run_id)s AND n.stat_id = c.stat_id AND n.chger_id = c.chger_id
                    AND n.attr_hash = c.attr_hash);

-- 신규·변경 버전 추가
INSERT INTO core.charger (
    stat_id, chger_id, valid_from, sgg_cd, stat_nm, chger_type, is_fast, output_kw, busi_id, busi_nm,
    kind, kind_detail, limit_yn, parking_free, addr, geom, boundary_ver, adm_cd, assign_status, attr_hash, load_id)
SELECT n.stat_id, n.chger_id, %(snapshot_date)s, n.sgg_cd, n.stat_nm, n.chger_type, n.is_fast, n.output_kw,
       n.busi_id, n.busi_nm, n.kind, n.kind_detail, n.limit_yn, n.parking_free, n.addr, n.geom, n.boundary_ver,
       n.adm_cd, n.assign_status, n.attr_hash, %(load_id)s
FROM staging.charger_norm n
WHERE n.run_id = %(run_id)s
  AND NOT EXISTS (SELECT 1 FROM core.charger c
                  WHERE c.valid_to IS NULL AND c.stat_id = n.stat_id AND c.chger_id = n.chger_id);
