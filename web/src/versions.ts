// 화면별 하단 버전 표시 (필요한 기준 시점만)
import { fmtDateTime, fmtMonth, type AppData } from "./data";

type Part = "ver" | "reg" | "road" | "publish" | "charger";

const PAGE_PARTS: Record<string, Part[]> = {
  "/": ["ver", "reg", "road", "publish"],
  "/priority": ["ver", "reg", "publish"],
  "/map": ["ver", "reg", "road"],
  "/regions": ["ver", "reg", "road"],
  "/criteria": ["ver"],
  "/trend": ["reg"],
  "/road": ["road"],
  "/supply": ["charger"],
};

// KST 월.일 (예: 11.03)
const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).slice(5).replace("-", ".");

// 경로별 표시 항목 (상세 카드는 행정동 목록 기준)
export function stampFor(path: string, data: AppData): string[] {
  const key = path.startsWith("/regions/") ? "/regions" : path;
  const parts = PAGE_PARTS[key];
  if (!parts) return [];
  const { meta, chargers } = data;
  const out: string[] = [];
  for (const p of parts) {
    if (p === "ver") out.push(meta.threshold.ver);
    if (p === "reg") out.push(`등록 ${fmtMonth(meta.base_month)}`);
    if (p === "road") out.push(`도로 ${shortDay(meta.traffic_window_start)}~${shortDay(meta.traffic_window_end)}`);
    if (p === "publish") out.push(`게시 ${shortDay(meta.published_at)}`);
    if (p === "charger" && chargers) out.push(`충전기 ${shortDay(chargers.snapshot_date)}`);
  }
  return out;
}

export const buildInfo = () => ({
  ...__BUILD__,
  short: __BUILD__.sha === "local" ? "local" : __BUILD__.sha.slice(0, 7),
  atText: fmtDateTime(__BUILD__.at),
});
