"""초기 관측 확보용 임시 수집기 (ev01 가동 전 한시 운영)

- 30분 간격(:00, :30)으로 core.target_link 대상 링크를 순회 호출
- 결과는 ev01과 같은 staging.traffic_raw 스키마로 적재 → ev01 후속 Task가 재처리
- 실행: docker compose --profile bootstrap up -d bootstrap-collector
"""
import logging
import os
import time
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import psycopg2
import psycopg2.extras
import requests

KST = timezone(timedelta(hours=9))
BASE_URL = 'http://openapi.seoul.go.kr:8088'
TARGET_SET = os.environ.get('BOOTSTRAP_TARGET_SET', 'mvp_3gu_v1')
INTERVAL_MIN = int(os.environ.get('BOOTSTRAP_INTERVAL_MIN', '30'))
WORKERS = int(os.environ.get('BOOTSTRAP_WORKERS', '2'))  # 동시 호출 제한
CHUNK_SIZE = 100
DAG_ID = 'bootstrap_collector'

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(DAG_ID)


# Airflow Connection URI → psycopg2 연결
def connect():
    u = urllib.parse.urlparse(os.environ['AIRFLOW_CONN_CONN_POSTGIS_EV'])
    return psycopg2.connect(host=u.hostname, port=u.port, dbname=u.path.lstrip('/'),
                            user=urllib.parse.unquote(u.username), password=urllib.parse.unquote(u.password))


def target_links(conn):
    with conn.cursor() as cur:
        cur.execute('SELECT service_link_id FROM core.target_link WHERE target_set = %s AND NOT is_excluded ORDER BY 1', (TARGET_SET,))
        return [r[0] for r in cur.fetchall()]


# 링크 1건 호출 → staging 행
def call_link(key, link_id):
    t0 = time.perf_counter()
    try:
        res = requests.get(f'{BASE_URL}/{key}/xml/TrafficInfo/1/5/{link_id}', timeout=10)
        root = ET.fromstring(res.content)
        code = root.findtext('.//CODE')
        row = root.find('row')
        spd = row.findtext('prcs_spd') if row is not None else None
        trv = row.findtext('prcs_trv_time') if row is not None else None
        status = 'ok' if code == 'INFO-000' and row is not None else ('no_data' if code == 'INFO-200' else 'api_error')
    except Exception as e:  # 네트워크·파싱 오류
        code, spd, trv, status = f'EXC:{type(e).__name__}', None, None, 'api_error'
    return code, status, spd, trv, int((time.perf_counter() - t0) * 1000)


def poll_once(key, slot):
    poll_batch_id = f'{DAG_ID}__{slot:%Y%m%dT%H%M}'
    conn = connect()
    try:
        links = target_links(conn)
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO ops.pipeline_run (dag_id, run_id, logical_date, partition_key, status, trigger_type)
                           VALUES (%s, %s, %s, %s, 'running', 'bootstrap')
                           ON CONFLICT (dag_id, run_id) DO UPDATE SET status = 'running', started_at = now()""",
                        (DAG_ID, poll_batch_id, slot, poll_batch_id))
        conn.commit()

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            results = list(ex.map(lambda l: (l, datetime.now(KST), *call_link(key, l)), links))

        rows = [(poll_batch_id, l, poll_batch_id, i // CHUNK_SIZE, ts, code, st, spd, trv, ms)
                for i, (l, ts, code, st, spd, trv, ms) in enumerate(results)]
        counts = {s: sum(1 for r in rows if r[6] == s) for s in ('ok', 'no_data', 'api_error')}
        status = 'success' if counts['api_error'] == 0 else ('failed' if counts['ok'] == 0 else 'partial')

        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO staging.traffic_raw (poll_batch_id, link_id, run_id, chunk_no, collected_at,
                                                 result_code, call_status, prcs_spd, prcs_trv_time, resp_ms)
                VALUES %s ON CONFLICT (poll_batch_id, link_id) DO NOTHING""", rows)
            cur.execute("""UPDATE ops.pipeline_run SET status = %s, finished_at = now(), detail = %s
                           WHERE dag_id = %s AND run_id = %s""",
                        (status, psycopg2.extras.Json({'target': len(links), **counts}), DAG_ID, poll_batch_id))
        conn.commit()
        log.info('%s %s target=%d %s', poll_batch_id, status, len(links), counts)
    finally:
        conn.close()


# 다음 수집 슬롯 (:00, :30 정렬)
def next_slot(now):
    base = now.replace(second=0, microsecond=0)
    minutes = (base.minute // INTERVAL_MIN + 1) * INTERVAL_MIN
    return base.replace(minute=0) + timedelta(minutes=minutes)


def main():
    key = os.environ['AIRFLOW_VAR_APIKEY_SEOUL_TRAFFIC']
    slot = datetime.now(KST).replace(second=0, microsecond=0)  # 기동 직후 1회
    while True:
        try:
            poll_once(key, slot)
        except Exception:
            log.exception('수집 실패: %s', slot)
        slot = next_slot(datetime.now(KST))
        time.sleep(max(0, (slot - datetime.now(KST)).total_seconds()))


if __name__ == '__main__':
    main()
