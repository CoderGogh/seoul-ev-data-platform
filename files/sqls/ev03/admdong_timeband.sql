-- 행정동 × 시간대(주간) 평균 속도 후보: 링크별 시간대 평균 → 도로 길이 가중 (기본) / 단순 평균 (민감도)
-- 파라미터: run_id, base_month, window_start, window_end, target_set
DELETE FROM mart.candidate_admdong_timeband WHERE run_id = %(run_id)s;

INSERT INTO mart.candidate_admdong_timeband (base_month, adm_cd, timeband, avg_spd_len, avg_spd_simple, link_cnt,
                                             obs_cnt, run_id)
WITH tl AS (
    SELECT t.service_link_id, t.adm_cd, s.length_m
    FROM core.target_link t
    JOIN core.service_link s ON s.link_ver = t.link_ver AND s.service_link_id = t.service_link_id
    WHERE t.target_set = %(target_set)s AND NOT t.is_excluded
), link_tb AS (  -- 링크 × 시간대: 분석 기간 내 확정 대표값 평균
    SELECT lt.link_id, lt.timeband, avg(lt.rep_spd) AS spd, sum(lt.obs_cnt) AS obs_cnt
    FROM core.link_timeband lt
    WHERE lt.is_final AND lt.timeband BETWEEN 7 AND 21
      AND (lt.obs_date + make_interval(hours => lt.timeband)) AT TIME ZONE 'Asia/Seoul' >= %(window_start)s::timestamptz
      AND (lt.obs_date + make_interval(hours => lt.timeband + 1)) AT TIME ZONE 'Asia/Seoul' <= %(window_end)s::timestamptz
    GROUP BY 1, 2
)
SELECT %(base_month)s, tl.adm_cd, lb.timeband,
       round(sum(lb.spd * tl.length_m) / nullif(sum(tl.length_m), 0), 1),
       round(avg(lb.spd), 1),
       count(*), sum(lb.obs_cnt), %(run_id)s
FROM link_tb lb JOIN tl ON tl.service_link_id = lb.link_id
GROUP BY tl.adm_cd, lb.timeband;
