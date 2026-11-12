// 화면용 파생 지표 (판정 근접·구별 추세·도로 여건 분포)
import { HINT_ORDER, fmtMonth, type AppData, type ChargerHint, type Links, type Region } from "./data";

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

// 링크 도로 여건 (동 판정과 같은 경계, 관측 없으면 null)
export function linkHint(low: number | null, fastMax: number, slowMin: number): ChargerHint | null {
  if (low == null) return null;
  return low < fastMax ? "fast" : low >= slowMin ? "slow" : "mixed";
}

export interface LinkTile {
  id: string;
  adm_cd: string;
  adm_nm: string;
  low: number | null;
  n: number;
  hint: ChargerHint | null;
}

// 자치구별 링크 타일 (동 이름·저속 비중 순), 게시 안 된 동 링크 제외
export function linkTiles(links: Links, regions: Region[], fastMax: number, slowMin: number) {
  const dong = new Map(regions.map((r) => [r.adm_cd, r]));
  const groups = new Map<string, LinkTile[]>();
  links.links.forEach(([id, cd, low, n]) => {
    const r = dong.get(cd);
    if (!r) return;
    const tiles = groups.get(r.sgg_nm) ?? [];
    tiles.push({ id, adm_cd: cd, adm_nm: r.adm_nm, low, n, hint: linkHint(low, fastMax, slowMin) });
    groups.set(r.sgg_nm, tiles);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "ko"))
    .map(([sgg, tiles]) => ({
      sgg,
      tiles: tiles.sort((a, b) => a.adm_nm.localeCompare(b.adm_nm, "ko") || (a.low ?? -1) - (b.low ?? -1)),
      counts: Object.fromEntries([...HINT_ORDER, "none"].map((h) => [h, tiles.filter((t) => (t.hint ?? "none") === h).length])),
    }));
}
