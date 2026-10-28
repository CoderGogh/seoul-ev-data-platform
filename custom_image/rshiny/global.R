library(shiny)
library(DBI)
library(RPostgres)
library(pool)
library(dplyr)
library(ggplot2)

# 분석 DB 커넥션 풀 (읽기 전용 계정)
db_pool <- dbPool(
  RPostgres::Postgres(),
  host     = Sys.getenv("EV_DB_HOST"),
  port     = as.integer(Sys.getenv("EV_DB_PORT", "5432")),
  dbname   = Sys.getenv("EV_DB_NAME"),
  user     = Sys.getenv("EV_DB_USER"),
  password = Sys.getenv("EV_DB_PASSWORD"),
  bigint   = "numeric",  # integer64 대신 일반 숫자
  timezone = "Asia/Seoul",  # 세션·출력 시각 KST
  timezone_out = "Asia/Seoul"
)
onStop(function() poolClose(db_pool))

# 한글 폰트 테마
theme_set(theme_minimal(base_family = "NanumGothic", base_size = 13))
class_colors <- c(A = "#d62728", B = "#ff7f0e", C = "#7f7f7f", REF = "#1f77b4", WITHHELD = "#000000")
sgg_colors <- c("강남구" = "#e45756", "서초구" = "#4c78a8", "송파구" = "#54a24b")

q <- function(sql) dbGetQuery(db_pool, sql)

# 조회
load_runs <- function() q("
  SELECT dag_id, status, count(*)::int AS n, max(started_at) AS last_run
  FROM ops.pipeline_run GROUP BY 1, 2 ORDER BY 1, 2")
load_coverage <- function() q("
  SELECT collected_at, poll_batch_id, round(100.0 * ok_cnt / target_cnt, 2) AS ok_pct, api_error_cnt, no_data_cnt
  FROM ops.poll_coverage ORDER BY collected_at")
load_publish <- function() q("SELECT base_month, status, last_published_at, reason FROM ops.publish_status ORDER BY 1")
load_trend <- function() q("
  SELECT sgg_nm, adm_nm, ev_cnt, prev_ev_cnt,
         round(100.0 * (ev_cnt - prev_ev_cnt) / nullif(prev_ev_cnt, 0), 1) AS yoy,
         round(100.0 * ev_cnt / nullif(total_cnt, 0), 2) AS ev_share
  FROM mart.v_reg_trend")
load_threshold <- function() q("SELECT * FROM mart.v_active_threshold")
load_profile <- function() q("SELECT sgg_nm, adm_nm, obs_date, timeband, avg_spd, link_cnt FROM mart.v_timeband_profile")
load_result <- function() q("
  SELECT base_month, sgg_nm, adm_nm, classification, quality_grade, ev_cnt, ev_yoy_rate, coverage,
         avg_spd, low_spd_ratio, charger_hint_nm,
         array_to_string(reason_codes, ', ') AS reasons, publish_status, last_published_at, threshold_ver
  FROM mart.v_admdong_result ORDER BY sgg_nm, adm_nm")
