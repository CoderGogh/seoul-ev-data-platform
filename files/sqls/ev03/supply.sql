-- 행정동 공급 지표 (공급 기준일 시점 충전기 이력, 동 귀속분, 버스전용 제외)
-- 파라미터: run_id, charger_asof (NULL 이면 미산출)
WITH c AS (
    SELECT ch.adm_cd,
           count(*) AS n,
           count(*) FILTER (WHERE ch.is_fast) AS fast,
           count(*) FILTER (WHERE ch.limit_yn = 'N') AS open_n
    FROM core.charger ch
    LEFT JOIN core.charger_type t ON t.chger_type = ch.chger_type
    WHERE ch.assign_status = 'assigned' AND coalesce(t.passenger, true)  -- 미등록 타입은 승용으로
      AND ch.valid_from <= %(charger_asof)s::date
      AND (ch.valid_to IS NULL OR ch.valid_to > %(charger_asof)s::date)
    GROUP BY ch.adm_cd
)
UPDATE mart.candidate_admdong_indicator i
SET charger_asof = %(charger_asof)s::date,
    charger_cnt = coalesce(c.n, 0),
    fast_cnt = coalesce(c.fast, 0),
    open_cnt = coalesce(c.open_n, 0),
    ev_per_charger = round(i.ev_cnt::numeric / nullif(c.n, 0), 2)
FROM mart.candidate_admdong_indicator x
LEFT JOIN c ON c.adm_cd = x.adm_cd
WHERE i.run_id = %(run_id)s AND x.run_id = i.run_id AND x.adm_cd = i.adm_cd
  AND %(charger_asof)s::date IS NOT NULL;
