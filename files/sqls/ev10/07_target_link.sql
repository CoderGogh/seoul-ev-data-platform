-- 수집 대상 링크 고정 (커버리지 분모). 중점이 대상 자치구 행정동에 귀속된 링크
-- 변수: target_set, link_ver, boundary_ver, target_sgg (쉼표 구분 자치구명)
DELETE FROM core.target_link WHERE target_set = :'target_set';
INSERT INTO core.target_link (target_set, service_link_id, adm_cd, link_ver, boundary_ver)
SELECT :'target_set', la.service_link_id, la.adm_cd, la.link_ver, la.boundary_ver
FROM core.link_admdong la
JOIN core.admdong a ON a.boundary_ver = la.boundary_ver AND a.adm_cd = la.adm_cd
WHERE la.link_ver = :'link_ver' AND la.boundary_ver = :'boundary_ver'
  AND la.assign_status IN ('assigned', 'multi_resolved')
  AND a.sgg_nm = ANY (string_to_array(:'target_sgg', ','));
