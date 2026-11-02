-- 수집 대상 자치구 (대상 링크가 속한 행정동의 시군구)
-- 파라미터: target_set
SELECT DISTINCT a.sgg_cd, a.sgg_nm
FROM core.target_link t
JOIN core.admdong a ON a.boundary_ver = t.boundary_ver AND a.adm_cd = t.adm_cd
WHERE t.target_set = %(target_set)s
ORDER BY a.sgg_cd;
