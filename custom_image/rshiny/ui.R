ui <- navbarPage(
  "서울 전동화 입지 인사이트",
  tabPanel("운영 현황",
    fluidRow(
      column(6, h4("DAG별 데이터 상태 (ops.pipeline_run)"), tableOutput("runs")),
      column(6, h4("게시 상태"), tableOutput("publish"))
    ),
    h4("수집 회차별 정상 응답률 (대상 914개 링크)"),
    plotOutput("coverage_plot", height = 300)
  ),
  tabPanel("전동화 규모×추세",
    p("행정동별 전기차 대수(2026-09)와 전년 동월 대비 증가율. 점선은 유형 A 임계값(두 값 모두 이상이면 A 후보)."),
    plotOutput("trend_plot", height = 520),
    tableOutput("threshold")
  ),
  tabPanel("월별 추세",
    p("최근 12개월 증가 양상 (보조 지표, 분류 판정에는 미사용). 한 달 몰림: 1년 증가분 절반 이상이 한 달에. 최근 가속: 최근 3개월이 직전 3개월의 1.5배 이상."),
    plotOutput("total_plot", height = 300),
    plotOutput("a_trend_plot", height = 420),
    plotOutput("watch_plot", height = 240),
    tableOutput("momentum_table")
  ),
  tabPanel("시간대 도로 환경",
    fluidRow(
      column(3, selectInput("sgg", "자치구", choices = c("강남구", "서초구", "송파구"))),
      column(5, uiOutput("dong_ui"))
    ),
    p("확정된 시간대만 표시. 링크별 대표 속도를 도로 길이로 가중 평균."),
    plotOutput("profile_plot", height = 420)
  ),
  tabPanel("분류 결과",
    uiOutput("result_notice"),
    plotOutput("class_plot", height = 300),
    h4("우선 검토 지역 · 충전소 유형 참고"),
    p("유형은 도로 저속 비중(15km/h 미만)으로 나눈 참고값. 모든 차량 속도라 수요 지표가 아니며 현장 조사 전 참고용."),
    tableOutput("a_table"),
    h4("전체 행정동"),
    tableOutput("result_table")
  )
)
