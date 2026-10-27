-- 게시: 기준월 파티션 전체 교체 + 게시 로그 + 게시 상태 + 평가 이력 (단일 트랜잭션, 계보 원자화)
-- 파라미터: run_id, base_month, fingerprint, reg_load_id, prev_load_id, link_ver, boundary_ver, threshold_ver,
--           target_set, window_start, window_end, request_id
DELETE FROM mart.fact_admdong_indicator WHERE base_month = %(base_month)s;

INSERT INTO mart.fact_admdong_indicator
SELECT * FROM mart.candidate_admdong_indicator WHERE run_id = %(run_id)s;

DELETE FROM mart.fact_admdong_timeband WHERE base_month = %(base_month)s;

INSERT INTO mart.fact_admdong_timeband
SELECT * FROM mart.candidate_admdong_timeband WHERE run_id = %(run_id)s;

INSERT INTO ops.publish_log (base_month, run_id, fingerprint, reg_load_id, prev_reg_load_id, link_ver, boundary_ver,
                             threshold_ver, target_set, traffic_window_start, traffic_window_end, period_mismatch,
                             region_cnt, request_id)
SELECT %(base_month)s, %(run_id)s, %(fingerprint)s, %(reg_load_id)s, %(prev_load_id)s, %(link_ver)s,
       %(boundary_ver)s, %(threshold_ver)s, %(target_set)s, %(window_start)s::timestamptz,
       %(window_end)s::timestamptz, true,
       (SELECT count(*) FROM mart.candidate_admdong_indicator WHERE run_id = %(run_id)s), %(request_id)s;

INSERT INTO ops.publish_status (base_month, status, last_published_run, last_published_at, reason, updated_at)
VALUES (%(base_month)s, 'current', %(run_id)s, now(), NULL, now())
ON CONFLICT (base_month) DO UPDATE
SET status = 'current', last_published_run = EXCLUDED.last_published_run,
    last_published_at = EXCLUDED.last_published_at, reason = NULL, updated_at = now();

INSERT INTO ops.mart_eval (base_month, run_id, fingerprint, eval_status)
VALUES (%(base_month)s, %(run_id)s, %(fingerprint)s, 'published')
ON CONFLICT (base_month, run_id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, eval_status = 'published';

DELETE FROM mart.candidate_admdong_indicator WHERE run_id = %(run_id)s;

DELETE FROM mart.candidate_admdong_timeband WHERE run_id = %(run_id)s;
