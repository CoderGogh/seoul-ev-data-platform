-- 링크 × 날짜 × 시간대 대표 관측 (이번 회차가 건드린 시간대만 재계산)
-- 대표: 시간대 중앙(HH:30, KST)에 가장 가까운 유효 관측, 동률이면 먼저 수집된 값
-- 확정: 시간대가 끝났으면 is_final
WITH touched AS (
    SELECT DISTINCT o.link_id,
           (o.collected_at AT TIME ZONE 'Asia/Seoul')::date AS obs_date,
           extract(hour FROM o.collected_at AT TIME ZONE 'Asia/Seoul')::int AS timeband
    FROM core.traffic_obs o
    WHERE o.poll_batch_id = ANY (%(batch_ids)s)
), ranked AS (
    SELECT t.link_id, t.obs_date, t.timeband, o.prcs_spd, o.prcs_trv_time, o.collected_at,
           count(*) OVER w AS obs_cnt,
           row_number() OVER (
               PARTITION BY t.link_id, t.obs_date, t.timeband
               ORDER BY abs(extract(epoch FROM (o.collected_at AT TIME ZONE 'Asia/Seoul')
                                     - (t.obs_date + make_interval(hours => t.timeband, mins => 30)))),
                        o.collected_at) AS rn
    FROM touched t
    JOIN core.traffic_obs o
      ON o.link_id = t.link_id
     AND (o.collected_at AT TIME ZONE 'Asia/Seoul')::date = t.obs_date
     AND extract(hour FROM o.collected_at AT TIME ZONE 'Asia/Seoul') = t.timeband
    WINDOW w AS (PARTITION BY t.link_id, t.obs_date, t.timeband)
)
INSERT INTO core.link_timeband (link_id, obs_date, timeband, rep_spd, rep_trv_time, rep_collected_at, obs_cnt,
                                is_final, updated_at)
SELECT link_id, obs_date, timeband, prcs_spd, prcs_trv_time, collected_at, obs_cnt,
       now() >= ((obs_date + make_interval(hours => timeband + 1)) AT TIME ZONE 'Asia/Seoul'),
       now()
FROM ranked
WHERE rn = 1
ON CONFLICT (link_id, obs_date, timeband) DO UPDATE
SET rep_spd = EXCLUDED.rep_spd, rep_trv_time = EXCLUDED.rep_trv_time,
    rep_collected_at = EXCLUDED.rep_collected_at, obs_cnt = EXCLUDED.obs_cnt,
    is_final = EXCLUDED.is_final, updated_at = now();
