server <- function(input, output, session) {
  # 5분마다 갱신
  tick <- reactiveTimer(300000)

  # 운영 현황
  output$runs <- renderTable({ tick(); load_runs() %>% mutate(last_run = format(last_run, "%m-%d %H:%M")) })
  output$publish <- renderTable({ tick(); load_publish() })
  output$coverage_plot <- renderPlot({
    tick()
    d <- load_coverage()
    validate(need(nrow(d) > 0, "수집 회차 없음"))
    ggplot(d, aes(collected_at, ok_pct)) +
      geom_line(color = "#4c78a8") + geom_point(aes(size = api_error_cnt), color = "#e45756", alpha = 0.6) +
      scale_size_continuous(name = "API 오류 수", range = c(1, 5)) +
      labs(x = "수집 시각", y = "정상 응답률 (%)") + coord_cartesian(ylim = c(90, 100))
  })

  # 규모×추세 산점도
  output$trend_plot <- renderPlot({
    d <- load_trend(); th <- load_threshold()
    validate(need(nrow(d) > 0, "등록 스냅샷 없음"))
    p <- ggplot(d, aes(ev_cnt, yoy, color = sgg_nm)) +
      geom_point(size = 3, alpha = 0.8) +
      scale_color_manual(values = sgg_colors, name = "자치구") +
      labs(x = "전기차 등록 대수", y = "전년 동월 대비 증가율 (%)")
    if (nrow(th) > 0) {
      p <- p + geom_vline(xintercept = th$a_min_ev_cnt, linetype = "dashed") +
        geom_hline(yintercept = th$a_min_yoy_rate, linetype = "dashed") +
        annotate("text", x = Inf, y = Inf, label = "A 후보", hjust = 1.2, vjust = 1.5, family = "NanumGothic")
    }
    p
  })
  output$threshold <- renderTable(load_threshold() %>% select(threshold_ver, basis, a_min_ev_cnt, a_min_yoy_rate))

  # 시간대 도로 환경
  profile <- reactive({ tick(); load_profile() })
  output$dong_ui <- renderUI({
    d <- profile() %>% filter(sgg_nm == input$sgg)
    selectInput("dongs", "행정동 (비우면 자치구 평균)", choices = sort(unique(d$adm_nm)), multiple = TRUE)
  })
  output$profile_plot <- renderPlot({
    d <- profile() %>% filter(sgg_nm == input$sgg)
    validate(need(nrow(d) > 0, "확정된 시간대 없음"))
    d <- if (length(input$dongs)) filter(d, adm_nm %in% input$dongs) else
      d %>% group_by(obs_date, timeband) %>% summarise(avg_spd = mean(avg_spd), .groups = "drop") %>% mutate(adm_nm = input$sgg)
    ggplot(d, aes(timeband, avg_spd, color = adm_nm, linetype = factor(obs_date))) +
      geom_line() + geom_point() +
      scale_x_continuous(breaks = 0:23) +
      labs(x = "시간대 (시)", y = "평균 속도 (km/h)", color = "지역", linetype = "날짜")
  })

  # 분류 결과
  result <- reactive({ tick(); load_result() })
  output$result_notice <- renderUI({
    if (nrow(result()) == 0) {
      st <- load_publish()
      tags$div(class = "alert alert-warning",
        "아직 게시된 결과 없음. 게시 상태: ",
        if (nrow(st)) paste(st$base_month, st$status, st$reason) else "평가 전")
    } else {
      r <- result()[1, ]
      tags$p(sprintf("기준월 %s · 게시 %s · 상태 %s · 임계값 %s", r$base_month,
                     format(r$last_published_at, "%m-%d %H:%M"), r$publish_status, r$threshold_ver))
    }
  })
  output$class_plot <- renderPlot({
    d <- result()
    validate(need(nrow(d) > 0, ""))
    ggplot(d, aes(sgg_nm, fill = classification)) + geom_bar() +
      scale_fill_manual(values = class_colors, name = "유형") + labs(x = NULL, y = "행정동 수")
  })
  # 우선 검토 지역 + 충전소 유형 참고
  output$a_table <- renderTable({
    d <- result() %>% filter(classification == "A")
    validate(need(nrow(d) > 0, "우선 검토 지역 없음"))
    d %>% arrange(desc(ev_cnt)) %>%
      transmute(자치구 = sgg_nm, 행정동 = sub("^서울특별시 \\S+ ", "", adm_nm), 전기차 = ev_cnt,
                `증가율(%)` = ev_yoy_rate, `저속 비중(%)` = low_spd_ratio, `평균 속도` = avg_spd,
                `충전소 유형 참고` = charger_hint_nm)
  })
  output$result_table <- renderTable(result() %>% select(sgg_nm, adm_nm, classification, quality_grade, ev_cnt,
                                                         ev_yoy_rate, coverage, low_spd_ratio, charger_hint_nm,
                                                         reasons))
}
