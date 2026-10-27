# 등록현황 보고서 양식 xlsx 파서 (표준 라이브러리, 코드 없이 이름만 있는 과거 파일용)
import re
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
HEADER_ROWS = 8  # 제목·출력정보·2단 헤더
SUM_COLS = range(5, 17)  # 관용·자가용·영업용 × 승용·승합·화물·특수


def _col_index(ref):
    n = 0
    for ch in ref:
        if not ch.isalpha():
            break
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_rows(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        shared = ["".join(t.text or "" for t in si.iter(NS + "t")) for si in root.findall(NS + "si")]
    rows = []
    for r in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(NS + "row"):
        cells = {}
        for c in r.findall(NS + "c"):
            v = c.find(NS + "v")
            val = v.text if v is not None else None
            if c.get("t") == "s" and val is not None:
                val = shared[int(val)]
            elif c.get("t") == "inlineStr":
                val = "".join(t.text or "" for t in c.iter(NS + "t"))
            cells[_col_index(c.get("r"))] = val
        rows.append([cells.get(i) for i in range(max(cells) + 1)] if cells else [])
    return rows


def _num(x):
    return int(float(str(x).replace(",", ""))) if x not in (None, "") else 0


# 보고서 → 상세 행 (병합 셀 전방 채우기, 소계·합계 행 제외)
# 반환: stats_ym(YYYYMM), 상세 행 목록, 파일의 서울 합계
def parse_report(path):
    rows = read_rows(path)
    stats_ym, seoul_total, details = None, None, []
    for r in rows[:HEADER_ROWS]:
        if r and r[0] and str(r[0]).startswith("기준일자"):
            stats_ym = re.sub(r"\D", "", str(r[1]))[:6]  # 2025.09 → 202509

    sgg = dong = None
    for r in rows[HEADER_ROWS:]:
        r = r + [None] * (17 - len(r))
        if r[0] == "서울":
            seoul_total = _num(r[4])
            continue
        if r[0]:
            sgg = str(r[0]).strip()
        if r[2]:
            dong = str(r[2]).strip()
        if r[3] is None:  # 소계 행
            continue
        details.append(
            {
                "sgg_nm": sgg,
                "adstrd_nm": dong,
                "fuel_nm": str(r[3]).strip(),
                "sum_tot": None if r[4] in (None, "") else str(r[4]),
                "sums": [None if r[i] in (None, "") else str(r[i]) for i in SUM_COLS],
            }
        )
    return stats_ym, details, seoul_total
