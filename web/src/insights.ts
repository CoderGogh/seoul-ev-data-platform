// 화면용 파생 지표 (판정 근접·구별 추세·도로 여건 분포)
import { HINT_ORDER, fmtMonth, type AppData, type ChargerHint, type Region } from "./data";

// 기준 하나는 충족, 나머지도 80% 이상 도달한 관찰 대상
export function nearMiss(regions: Region[], minEv: number, minYoy: number) {
  return regions
    .filter((r) => r.classification !== "A" && r.ev_yoy_rate != null)
    .filter(
      (r) =>
        (r.ev_cnt >= minEv && r.ev_yoy_rate! >= minYoy * 0.8) || (r.ev_yoy_rate! >= minYoy && r.ev_cnt >= minEv * 0.8),
    )
    .map((r) => ({
      region: r,
      short: r.ev_cnt < minEv ? `전기차 ${minEv - r.ev_cnt}대 부족` : `증가율 ${(minYoy - r.ev_yoy_rate!).toFixed(1)}%p 부족`,
    }));
}

// 증가 양상 주의 대상 (판정 미사용 보조 지표)
export function watchList(regions: Region[]) {
  return regions.filter((r) => r.growth_pattern === "한 달 몰림" || r.growth_pattern === "최근 가속");
}

// 월별 합계 (전체·자치구별)
export function monthlyTotals(data: AppData) {
  const sggOf = new Map(data.regions.map((r) => [r.adm_cd, r.sgg_nm]));
  const rows = new Map<string, Record<string, number>>();
  Object.entries(data.monthly).forEach(([cd, series]) =>
    series.forEach((pt) => {
      const row = rows.get(pt.base_month) ?? { total: 0 };
      const sgg = sggOf.get(cd);
      row.total += pt.ev_cnt;
      if (sgg) row[sgg] = (row[sgg] ?? 0) + pt.ev_cnt;
      rows.set(pt.base_month, row);
    }),
  );
  return [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, row]) => ({ month: fmtMonth(m), ...row }) as { month: string; total: number } & Record<string, number>);
}

// 도로 여건 분포 (전체·우선 검토)
export function hintCounts(regions: Region[]) {
  return HINT_ORDER.map((h: ChargerHint) => ({
    hint: h,
    all: regions.filter((r) => r.charger_hint === h).length,
    priority: regions.filter((r) => r.charger_hint === h && r.classification === "A").length,
  }));
}

// 시간대별 평균 속도 (67개 동 단순 평균)
export function timebandAverage(data: AppData) {
  const acc = new Map<number, { label: string; sum: number; n: number }>();
  Object.values(data.timeband).forEach((series) =>
    series.forEach((pt) => {
      const a = acc.get(pt.timeband) ?? { label: pt.label, sum: 0, n: 0 };
      a.sum += pt.avg_spd;
      a.n += 1;
      acc.set(pt.timeband, a);
    }),
  );
  return [...acc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tb, a]) => ({ timeband: tb, label: a.label, avg_spd: Math.round((a.sum / a.n) * 10) / 10 }));
}
