"""API 실증 검증 (RFP §05)

사용
    python scripts/verify_apis.py reg                      # 등록현황 전수 수집·구조 점검
    python scripts/verify_apis.py traffic                  # 도로소통 단건 구조 점검
    python scripts/verify_apis.py traffic --polls 6 --interval 60   # 갱신 특성 관측

결과: files/verify/<실행시각>/ (원천 응답·리포트, 커밋 제외)
"""
import argparse
import json
import statistics
import time
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = 'http://openapi.seoul.go.kr:8088'
PAGE_SIZE = 1000  # API 1회 최대 건수
SAMPLE_LINK_ID = '1220003800'  # 명세 샘플 링크


# .env 로드 (외부 의존성 없이)
def load_env():
    env = {}
    for line in (ROOT / '.env').read_text().splitlines():
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()
    return env


# API 호출 → (XML 루트, 응답시간 초)
def call(key, fmt, service, start, end, *extra):
    path = '/'.join([key, fmt, service, str(start), str(end), *extra])
    t0 = time.perf_counter()
    with urllib.request.urlopen(f'{BASE_URL}/{path}', timeout=30) as res:
        body = res.read()
    return body, time.perf_counter() - t0


# 결과 코드·총건수·행 추출
def parse(body):
    root = ET.fromstring(body)
    code = root.findtext('.//RESULT/CODE') or root.findtext('.//CODE')
    msg = root.findtext('.//RESULT/MESSAGE') or root.findtext('.//MESSAGE')
    total = root.findtext('list_total_count')
    # 필드명 대소문자 통일 (명세는 대문자, 실제 도로소통 응답은 소문자)
    rows = [{c.tag.upper(): c.text for c in row} for row in root.findall('row')]
    return code, msg, int(total) if total else None, rows


def save(out_dir, name, data):
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / name
    if isinstance(data, bytes):
        p.write_bytes(data)
    else:
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str))
    return p


# 등록현황 전수 수집·구조 점검
def verify_registration(key, out_dir):
    body, _ = call(key, 'xml', 'TbDongFuelCar', 1, 5)
    save(out_dir, 'reg_sample.xml', body)
    code, msg, total, _ = parse(body)
    print(f'[reg] 결과 {code} {msg} / list_total_count={total}')
    if code != 'INFO-000':
        return

    # 페이지 순회
    rows, pages, elapsed = [], 0, []
    for start in range(1, total + 1, PAGE_SIZE):
        body, sec = call(key, 'xml', 'TbDongFuelCar', start, min(start + PAGE_SIZE - 1, total))
        code, _, _, page_rows = parse(body)
        if code != 'INFO-000':
            print(f'[reg] 페이지 {start} 실패: {code}')
        rows += page_rows
        pages += 1
        elapsed.append(sec)
    save(out_dir, 'reg_all.json', rows)

    cols = list(rows[0].keys()) if rows else []
    key_cols = ('STATS_YM', 'DONG_CD', 'FUEL_CD')
    dup = sum(c - 1 for c in Counter(tuple(r.get(k) for k in key_cols) for r in rows).values() if c > 1)
    sum_cols = [c for c in cols if c.startswith('SUM') and c != 'SUM_TOT']
    sum_mismatch = sum(
        1 for r in rows
        if r.get('SUM_TOT') is not None
        and sum(int(float(r[c] or 0)) for c in sum_cols) != int(float(r['SUM_TOT']))
    )

    report = {
        '총건수_명세': total,
        '수집건수': len(rows),
        '페이지수': pages,
        '페이지_평균응답초': round(statistics.mean(elapsed), 2) if elapsed else None,
        '컬럼': cols,
        '기준월_분포': dict(sorted(Counter(r.get('STATS_YM') for r in rows).items())),
        '시도': dict(Counter(r.get('CTPV_NM') for r in rows)),
        '시군구_수': len({r.get('SGG_CD') for r in rows}),
        '행정동_수': len({r.get('DONG_CD') for r in rows}),
        '연료_분포': dict(Counter(f"{r.get('FUEL_CD')}:{r.get('FUEL_NM')}" for r in rows)),
        '키중복_건수(STATS_YM,DONG_CD,FUEL_CD)': dup,
        'SUM_TOT_불일치_건수': sum_mismatch,
        '컬럼별_null_건수': {c: sum(1 for r in rows if r.get(c) in (None, '')) for c in cols},
        '행정동명_샘플': sorted({r.get('ADSTRD_NM') for r in rows})[:15],
    }
    save(out_dir, 'reg_report.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


# 도로소통 구조·갱신 특성 점검
def verify_traffic(key, out_dir, polls, interval, link_id):
    # 포맷·필수 인자 확인
    for label, fmt, extra in [('xml', 'xml', (link_id,)), ('json', 'json', (link_id,)), ('링크ID 생략', 'xml', ())]:
        try:
            body, sec = call(key, fmt, 'TrafficInfo', 1, 5, *extra)
            save(out_dir, f'traffic_{label}.{"json" if fmt == "json" else "xml"}', body)
            head = body[:300].decode('utf-8', 'replace').replace('\n', ' ')
            print(f'[traffic] {label}: {sec:.2f}s / {head}')
        except Exception as e:
            print(f'[traffic] {label}: 실패 {e}')

    # 반복 폴링 (같은 값 반복 여부·응답시간)
    obs = []
    for i in range(polls):
        body, sec = call(key, 'xml', 'TrafficInfo', 1, 5, link_id)
        code, _, total, rows = parse(body)
        r = rows[0] if rows else {}
        obs.append({
            'collected_at': datetime.now().isoformat(timespec='seconds'),
            'code': code, 'total': total, 'resp_sec': round(sec, 3),
            'PRCS_SPD': r.get('PRCS_SPD'), 'PRCS_TRV_TIME': r.get('PRCS_TRV_TIME'), 'fields': list(r.keys()),
        })
        print(f'[traffic] poll {i + 1}/{polls}: {obs[-1]}')
        if i < polls - 1:
            time.sleep(interval)

    values = [(o['PRCS_SPD'], o['PRCS_TRV_TIME']) for o in obs]
    report = {
        'link_id': link_id,
        '폴링_횟수': polls,
        '폴링_간격초': interval,
        '응답필드': obs[0]['fields'] if obs else [],
        '원천_관측시각_필드_존재': any('TIME' in f and f != 'PRCS_TRV_TIME' for f in (obs[0]['fields'] if obs else [])),
        '응답시간_평균초': round(statistics.mean(o['resp_sec'] for o in obs), 3) if obs else None,
        '고유값_수': len(set(values)),
        '연속_동일값_횟수': sum(1 for a, b in zip(values, values[1:]) if a == b),
        '관측': obs,
    }
    save(out_dir, 'traffic_report.json', report)
    print(json.dumps({k: v for k, v in report.items() if k != '관측'}, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description='서울 열린데이터광장 API 실증 검증')
    parser.add_argument('target', choices=['reg', 'traffic'])
    parser.add_argument('--polls', type=int, default=1)
    parser.add_argument('--interval', type=int, default=60)
    parser.add_argument('--link-id', default=SAMPLE_LINK_ID)
    args = parser.parse_args()

    env = load_env()
    out_dir = ROOT / 'files' / 'verify' / datetime.now().strftime('%Y%m%d_%H%M%S')
    if args.target == 'reg':
        verify_registration(env['SEOUL_REGISTRATION_API_KEY'], out_dir)
    else:
        verify_traffic(env['SEOUL_TRAFFIC_API_KEY'], out_dir, args.polls, args.interval, args.link_id)
    print(f'결과 저장: {out_dir.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
