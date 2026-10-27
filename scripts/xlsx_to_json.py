"""xlsx 첫 시트 → JSON 변환 (표준 라이브러리만, 병합 셀은 빈 값)

사용
    python scripts/xlsx_to_json.py 입력.xlsx 출력.json [--header]

--header: 첫 행을 header 로 분리 → {"header": [...], "rows": [[...]]}
기본: {"rows": [[...]]} (보고서 양식 파일용, 행 구조 그대로)
"""

import argparse
import json
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


# 셀 참조 → 열 번호 (A1 → 0)
def col_index(ref):
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
            cells[col_index(c.get("r"))] = val
        rows.append([cells.get(i) for i in range(max(cells) + 1)] if cells else [])
    return rows


def main():
    p = argparse.ArgumentParser()
    p.add_argument("src")
    p.add_argument("dst")
    p.add_argument("--header", action="store_true")
    a = p.parse_args()

    rows = read_rows(a.src)
    out = {"header": rows[0], "rows": rows[1:]} if a.header else {"rows": rows}
    with open(a.dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"{a.src} → {a.dst} ({len(rows)}행)")


if __name__ == "__main__":
    main()
