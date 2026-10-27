ui <- fluidPage(
  titlePanel("서울 전동화 입지 인사이트"),
  sidebarLayout(
    sidebarPanel(
      h4("DB 연결"),
      verbatimTextOutput("db_status")
    ),
    mainPanel(
      h4("조회 가능 테이블 (mart, ops)"),
      tableOutput("table_list")
    )
  )
)
