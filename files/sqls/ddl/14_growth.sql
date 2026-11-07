-- 등록 추세 보조 (ev03 momentum): 이상 증가 플래그·단순 예측. 분류 판정에는 미사용
-- fact·candidate 열 순서 동일 유지 (게시는 SELECT * 복사)
ALTER TABLE mart.fact_admdong_indicator ADD COLUMN IF NOT EXISTS growth_flags text[] NOT NULL DEFAULT '{}';  -- concentrated / accelerating
ALTER TABLE mart.fact_admdong_indicator ADD COLUMN IF NOT EXISTS max_month_share numeric(5, 1);  -- 1년 증가 중 최대 한 달 비중 %
ALTER TABLE mart.fact_admdong_indicator ADD COLUMN IF NOT EXISTS rate_3m numeric(7, 1);          -- 최근 3개월 증가율 %
ALTER TABLE mart.fact_admdong_indicator ADD COLUMN IF NOT EXISTS ev_fcst_3m int;                 -- 3개월 뒤 예상 (최근 6개월 월 증가 중앙값)
ALTER TABLE mart.fact_admdong_indicator ADD COLUMN IF NOT EXISTS ev_fcst_6m int;
ALTER TABLE mart.candidate_admdong_indicator ADD COLUMN IF NOT EXISTS growth_flags text[] NOT NULL DEFAULT '{}';
ALTER TABLE mart.candidate_admdong_indicator ADD COLUMN IF NOT EXISTS max_month_share numeric(5, 1);
ALTER TABLE mart.candidate_admdong_indicator ADD COLUMN IF NOT EXISTS rate_3m numeric(7, 1);
ALTER TABLE mart.candidate_admdong_indicator ADD COLUMN IF NOT EXISTS ev_fcst_3m int;
ALTER TABLE mart.candidate_admdong_indicator ADD COLUMN IF NOT EXISTS ev_fcst_6m int;
