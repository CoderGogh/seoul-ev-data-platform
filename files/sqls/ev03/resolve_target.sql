-- 대상 기준월: 지정값 또는 최신 스냅샷. 전년 동월 스냅샷 존재 여부와 입력 fingerprint
-- 공급 기준일: 기준월 말일, 충전기 이력 시작 전이면 첫 스냅샷일 (이후 일별 적재에 지문 흔들리지 않음)
-- 파라미터: base_month(NULL 가능), window_start, window_end, target_set
WITH m AS (
    SELECT coalesce(%(base_month)s::text, (SELECT max(base_month) FROM core.reg_snapshot)) AS base_month
), ch AS (
    SELECT m.base_month,
           greatest((to_date(m.base_month, 'YYYYMM') + interval '1 month - 1 day')::date,
                    (SELECT min(valid_from) FROM core.charger)) AS charger_asof
    FROM m
), v AS (
    SELECT m.base_month, ch.charger_asof,
           (SELECT max(load_id) FROM core.charger c
             WHERE c.valid_from <= ch.charger_asof AND (c.valid_to IS NULL OR c.valid_to > ch.charger_asof)) AS charger_load_id,
           to_char(to_date(m.base_month, 'YYYYMM') - interval '1 year', 'YYYYMM') AS prev_month,
           (SELECT max(load_id) FROM core.reg_snapshot s WHERE s.base_month = m.base_month) AS reg_load_id,
           (SELECT max(load_id) FROM core.reg_snapshot s
             WHERE s.base_month = to_char(to_date(m.base_month, 'YYYYMM') - interval '1 year', 'YYYYMM')) AS prev_load_id,
           (SELECT max(lt.updated_at) FROM core.link_timeband lt
              JOIN core.target_link t ON t.service_link_id = lt.link_id AND t.target_set = %(target_set)s
             WHERE lt.is_final
               AND (lt.obs_date + make_interval(hours => lt.timeband)) AT TIME ZONE 'Asia/Seoul' >= %(window_start)s::timestamptz
               AND (lt.obs_date + make_interval(hours => lt.timeband + 1)) AT TIME ZONE 'Asia/Seoul' <= %(window_end)s::timestamptz
           ) AS traffic_watermark,
           (SELECT version FROM core.master_version WHERE master_type = 'link' AND status = 'active') AS link_ver,
           (SELECT version FROM core.master_version WHERE master_type = 'boundary' AND status = 'active') AS boundary_ver,
           (SELECT threshold_ver FROM ops.threshold_version WHERE is_active) AS threshold_ver
    FROM m JOIN ch USING (base_month)
)
SELECT v.*,
       md5(concat_ws('|', v.base_month, v.reg_load_id, v.prev_load_id, v.traffic_watermark, v.link_ver,
                     v.boundary_ver, v.threshold_ver, %(window_start)s::text, %(window_end)s::text, %(target_set)s::text,
                     v.charger_asof, v.charger_load_id)) AS fingerprint,
       (SELECT fingerprint FROM ops.mart_eval e WHERE e.base_month = v.base_month
         ORDER BY evaluated_at DESC LIMIT 1) AS last_fingerprint
FROM v;
