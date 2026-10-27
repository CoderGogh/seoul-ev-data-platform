FROM rocker/shiny-verse:4.6.1

# DB 접속 패키지
RUN install2.r --error --skipinstalled RPostgres DBI pool

WORKDIR /app
COPY . /app
EXPOSE 3838
CMD ["R", "-e", "shiny::runApp('/app', port = 3838, host = '0.0.0.0')"]
