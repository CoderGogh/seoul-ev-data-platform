-- 행정동 수요 보조 지표 (보조 기준일 스냅샷, 동 귀속분, 판정 미사용)
-- 파라미터: run_id, aux_load_id (NULL 이면 미산출)
WITH s AS (SELECT snapshot_date FROM ops.aux_load WHERE load_id = %(aux_load_id)s::bigint),
apt AS (
    SELECT adm_cd, count(*) AS n, sum(hh_cnt) AS hh FROM core.apt_complex
    WHERE load_id = %(aux_load_id)s::bigint AND assign_status = 'assigned' GROUP BY adm_cd
),
pk AS (
    SELECT adm_cd, count(*) AS n, sum(space_cnt) AS spaces FROM core.public_parking
    WHERE load_id = %(aux_load_id)s::bigint AND assign_status = 'assigned' GROUP BY adm_cd
)
UPDATE mart.candidate_admdong_indicator i
SET aux_asof = s.snapshot_date,
    apt_complex_cnt = coalesce(apt.n, 0),
    apt_hh_cnt = coalesce(apt.hh, 0),
    parking_lot_cnt = coalesce(pk.n, 0),
    parking_space_cnt = coalesce(pk.spaces, 0)
FROM mart.candidate_admdong_indicator x
CROSS JOIN s
LEFT JOIN apt ON apt.adm_cd = x.adm_cd
LEFT JOIN pk ON pk.adm_cd = x.adm_cd
WHERE i.run_id = %(run_id)s AND x.run_id = i.run_id AND x.adm_cd = i.adm_cd;
