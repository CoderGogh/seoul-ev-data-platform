FROM rocker/shiny-verse:4.6.1

# 한글 폰트 (그래프 한글 깨짐 방지)
RUN apt-get update && apt-get install -y --no-install-recommends fonts-nanum && rm -rf /var/lib/apt/lists/*

# DB 접속 패키지
RUN install2.r --error --skipinstalled RPostgres DBI pool

WORKDIR /app
COPY . /app
EXPOSE 3838
CMD ["R", "-e", "shiny::runApp('/app', port = 3838, host = '0.0.0.0')"]
