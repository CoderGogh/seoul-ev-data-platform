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
  password = Sys.getenv("EV_DB_PASSWORD")
)

onStop(function() poolClose(db_pool))

# 조회 가능 테이블 목록
list_tables <- function() {
  dbGetQuery(db_pool, "
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema IN ('mart', 'ops')
    ORDER BY table_schema, table_name")
}
