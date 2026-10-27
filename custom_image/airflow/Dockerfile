FROM apache/airflow:3.3.2

# 추가 의존성 설치 (Airflow 버전 고정)
COPY requirements.txt /requirements.txt
RUN pip install --no-cache-dir "apache-airflow==${AIRFLOW_VERSION}" -r /requirements.txt
