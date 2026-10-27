# 공식 postgis 이미지 amd64 전용 → postgres 이미지에 PostGIS 직접 설치 (arm64 대응)
# postgis 패키지: shp2pgsql 등 적재 도구
FROM postgres:16

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-postgis-3 postgresql-16-postgis-3-scripts postgis \
    && rm -rf /var/lib/apt/lists/*
