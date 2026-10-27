-- 게시 보류: 이전 결과 유지, 게시 상태 stale (게시 이력 없으면 never_published), 평가 이력 기록
-- 파라미터: run_id, base_month, fingerprint, reason
INSERT INTO ops.publish_status (base_month, status, reason, updated_at)
VALUES (%(base_month)s, 'never_published', %(reason)s, now())
ON CONFLICT (base_month) DO UPDATE
SET status = CASE WHEN ops.publish_status.last_published_run IS NULL THEN 'never_published' ELSE 'stale' END,
    reason = EXCLUDED.reason, updated_at = now();

INSERT INTO ops.mart_eval (base_month, run_id, fingerprint, eval_status)
VALUES (%(base_month)s, %(run_id)s, %(fingerprint)s, 'held')
ON CONFLICT (base_month, run_id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, eval_status = 'held';
