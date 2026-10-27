server <- function(input, output, session) {
  # 연결 상태
  output$db_status <- renderText({
    tryCatch({
      v <- dbGetQuery(db_pool, "SELECT postgis_version() AS v")$v
      paste("연결 정상 / PostGIS", v)
    }, error = function(e) paste("연결 실패:", conditionMessage(e)))
  })

  # 테이블 목록 (마트 구축 전에는 빈 표)
  output$table_list <- renderTable(list_tables())
}
