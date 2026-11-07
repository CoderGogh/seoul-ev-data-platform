// 행정동 결과 CSV (엑셀 한글 깨짐 방지 BOM)
import { CLASS_LABEL, type Region } from "./data";

const COLS: [string, (r: Region) => unknown][] = [
  ["행정동 코드", (r) => r.adm_cd],
  ["자치구", (r) => r.sgg_nm],
  ["행정동", (r) => r.adm_nm],
  ["분류", (r) => CLASS_LABEL[r.classification]],
  ["품질 등급", (r) => r.quality_grade],
  ["전기차", (r) => r.ev_cnt],
  ["전년 동월", (r) => r.prev_ev_cnt],
  ["1년 증가율(%)", (r) => r.ev_yoy_rate],
  ["전기차 비중(%)", (r) => r.ev_share],
  ["충전기", (r) => r.charger_cnt],
  ["급속", (r) => r.fast_cnt],
  ["충전기 1대당 전기차", (r) => r.ev_per_charger],
  ["공급 부족", (r) => (r.supply_gap == null ? "" : r.supply_gap ? "Y" : "N")],
  ["저속 비중(%)", (r) => r.low_spd_ratio],
  ["도로 여건", (r) => r.charger_hint_nm],
  ["평균 속도(km/h)", (r) => r.avg_spd],
  ["커버리지(%)", (r) => r.coverage],
  ["증가 양상", (r) => r.growth_pattern],
  ["사유 코드", (r) => r.reason_codes.join(" ")],
];

// 값 이스케이프: 쉼표·따옴표·줄바꿈
const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Region[]): string {
  return "﻿" + [COLS.map(([h]) => h), ...rows.map((r) => COLS.map(([, f]) => f(r)))].map((l) => l.map(cell).join(",")).join("\r\n");
}

export function downloadCsv(rows: Region[], name: string) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
