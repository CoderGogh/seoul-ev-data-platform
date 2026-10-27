-- 기준 데이터 (재실행 안전)

-- 연료 코드 (2026-09 API 기준). 전기차 범위: 순수 전기(e)만
INSERT INTO core.fuel_code (fuel_cd, fuel_nm, is_ev) VALUES
    ('a', '휘발유', false), ('b', '경유', false), ('c', '엘피지', false),
    ('e', '전기', true), ('g', '휘발유(유연)', false), ('h', '휘발유(무연)', false),
    ('j', 'CNG', false), ('k', 'LNG', false),
    ('l', '하이브리드(휘발유+전기)', false), ('m', '하이브리드(경유+전기)', false),
    ('n', '하이브리드(LPG+전기)', false), ('o', '하이브리드(CNG+전기)', false),
    ('q', '수소', false), ('r', '수소전기', false), ('z', '기타연료', false)
ON CONFLICT (fuel_cd) DO UPDATE SET fuel_nm = EXCLUDED.fuel_nm, is_ev = EXCLUDED.is_ev;

-- 시간대 차원 (주간 07~21시)
INSERT INTO mart.dim_timeband (timeband, label, is_daytime)
SELECT h, lpad(h::text, 2, '0') || '-' || lpad(((h + 1) % 24)::text, 2, '0') || '시', h BETWEEN 7 AND 21
FROM generate_series(0, 23) h
ON CONFLICT (timeband) DO NOTHING;
