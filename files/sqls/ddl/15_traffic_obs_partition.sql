-- 도로 관측 이력 월 파티션 (수집 시각 KST 월). 보존 정리를 파티션 단위 삭제로
-- 멱등 키 (link_id, poll_batch_id) 는 적재 SQL 에서 보장 (파티션 키 포함 PK 제약)

-- 월 파티션 보장: from_ts 가 속한 달부터 months 개월 (이미 있으면 건너뜀)
CREATE OR REPLACE FUNCTION core.ensure_traffic_obs_partitions(from_ts timestamptz, months int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
    m date := date_trunc('month', from_ts AT TIME ZONE 'Asia/Seoul')::date;
    name text;
    created int := 0;
BEGIN
    FOR i IN 0 .. months - 1 LOOP
        name := 'traffic_obs_' || to_char(m, 'YYYYMM');
        IF to_regclass('core.' || name) IS NULL THEN
            EXECUTE format(
                'CREATE TABLE core.%I PARTITION OF core.traffic_obs FOR VALUES FROM (%L) TO (%L)',
                name, (m::timestamp AT TIME ZONE 'Asia/Seoul'),
                ((m + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul'));
            created := created + 1;
        END IF;
        m := (m + interval '1 month')::date;
    END LOOP;
    RETURN created;
END $$;

-- 기존 일반 테이블 → 파티션 테이블 전환 (데이터 이전, 한 번만)
DO $$
DECLARE
    lo timestamptz;
    hi timestamptz;
BEGIN
    IF (SELECT relkind FROM pg_class WHERE oid = 'core.traffic_obs'::regclass) = 'r' THEN
        ALTER TABLE core.traffic_obs RENAME TO traffic_obs_old;
        ALTER TABLE core.traffic_obs_old RENAME CONSTRAINT traffic_obs_pkey TO traffic_obs_old_pkey;
        ALTER INDEX core.traffic_obs_collected_idx RENAME TO traffic_obs_old_collected_idx;
        CREATE TABLE core.traffic_obs (
            link_id             text        NOT NULL,
            poll_batch_id       text        NOT NULL,
            collected_at        timestamptz NOT NULL,
            source_observed_at  timestamptz,                    -- 원천 미제공, 항상 NULL
            prcs_spd            numeric(6, 1) NOT NULL,         -- km/h
            prcs_trv_time       numeric(8, 1) NOT NULL,         -- 초
            run_id              text        NOT NULL,
            PRIMARY KEY (link_id, poll_batch_id, collected_at)
        ) PARTITION BY RANGE (collected_at);
        SELECT min(collected_at), max(collected_at) INTO lo, hi FROM core.traffic_obs_old;
        PERFORM core.ensure_traffic_obs_partitions(coalesce(lo, now()),
            coalesce(((extract(year FROM age(date_trunc('month', hi), date_trunc('month', lo))) * 12
                       + extract(month FROM age(date_trunc('month', hi), date_trunc('month', lo))))::int + 1, 1));
        INSERT INTO core.traffic_obs SELECT * FROM core.traffic_obs_old;
        DROP TABLE core.traffic_obs_old;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS traffic_obs_collected_idx ON core.traffic_obs (collected_at);
CREATE INDEX IF NOT EXISTS traffic_obs_batch_idx ON core.traffic_obs (poll_batch_id);  -- 회차 단위 집계
SELECT core.ensure_traffic_obs_partitions(now(), 2);

-- 만료 파티션 삭제: 달 전체가 보존 기간 경과 + 모든 행이 삭제 조건 충족(시간대 확정·해당 기간 게시·열린 재처리 없음)
-- dry_run 이면 대상만 반환
CREATE OR REPLACE FUNCTION core.drop_expired_traffic_obs_partitions(retention_days int, dry_run boolean)
RETURNS TABLE (partition_name text, row_cnt bigint) LANGUAGE plpgsql AS $$
DECLARE
    p record;
    blocked boolean;
BEGIN
    FOR p IN
        SELECT c.relname, (regexp_match(pg_get_expr(c.relpartbound, c.oid), 'TO \(''([^'']+)''\)'))[1]::timestamptz AS upper_ts
        FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'core.traffic_obs'::regclass
        ORDER BY c.relname
    LOOP
        CONTINUE WHEN p.upper_ts > now() - make_interval(days => retention_days);
        EXECUTE format($q$
            SELECT EXISTS (
                SELECT 1 FROM core.%I o
                WHERE NOT EXISTS (SELECT 1 FROM core.link_timeband lt
                                  WHERE lt.link_id = o.link_id AND lt.is_final
                                    AND lt.obs_date = (o.collected_at AT TIME ZONE 'Asia/Seoul')::date
                                    AND lt.timeband = extract(hour FROM o.collected_at AT TIME ZONE 'Asia/Seoul'))
                   OR NOT EXISTS (SELECT 1 FROM ops.publish_log pl
                                  WHERE o.collected_at BETWEEN pl.traffic_window_start AND pl.traffic_window_end)
                   OR EXISTS (SELECT 1 FROM ops.reprocess_request r
                              WHERE r.status IN ('requested', 'running')
                                AND (o.collected_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN r.date_from AND r.date_to))
        $q$, p.relname) INTO blocked;
        CONTINUE WHEN blocked;
        partition_name := p.relname;
        EXECUTE format('SELECT count(*) FROM core.%I', p.relname) INTO row_cnt;
        IF NOT dry_run THEN
            EXECUTE format('ALTER TABLE core.traffic_obs DETACH PARTITION core.%I', p.relname);
            EXECUTE format('DROP TABLE core.%I', p.relname);
        END IF;
        RETURN NEXT;
    END LOOP;
END $$;
