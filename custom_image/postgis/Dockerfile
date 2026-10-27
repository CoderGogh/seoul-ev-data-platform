# 공식 postgis 이미지 amd64 전용 → postgres 이미지에 PostGIS 직접 설치 (arm64 대응)
FROM postgres:16

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-postgis-3 postgresql-16-postgis-3-scripts \
    && rm -rf /var/lib/apt/lists/*
