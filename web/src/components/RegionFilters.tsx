// 행정동 필터 (자치구·분류·도로 여건·검색), 지도·목록 공용
import { useMemo, useState, type ReactNode } from "react";
import { CLASS_LABEL, HINT_LABEL, HINT_ORDER, type ChargerHint, type Region } from "../data";

export type ClassFilter = "all" | "A" | "REF";
export type HintFilter = "all" | ChargerHint;

interface ChipProps {
  on: boolean;
  onClick: () => void;
  count?: number;
  dot?: string;
  children: ReactNode;
}

export function Chip({ on, onClick, count, dot, children }: ChipProps) {
  return (
    <button className="chip-btn" aria-pressed={on} onClick={onClick}>
      {dot && <i className="dot" style={{ background: dot }} />}
      {children}
      {count != null && <span className="count">{count}</span>}
    </button>
  );
}

export function useRegionFilters(regions: Region[]) {
  const [sgg, setSgg] = useState("all");
  const [cls, setCls] = useState<ClassFilter>("all");
  const [hint, setHint] = useState<HintFilter>("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(
    () =>
      regions.filter(
        (r) =>
          (sgg === "all" || r.sgg_nm === sgg) &&
          (cls === "all" || (cls === "A" ? r.classification === "A" : r.classification !== "A")) &&
          (hint === "all" || r.charger_hint === hint) &&
          (!q || r.adm_nm.includes(q.trim())),
      ),
    [regions, sgg, cls, hint, q],
  );

  return { sgg, setSgg, cls, setCls, hint, setHint, q, setQ, filtered };
}

type Filters = ReturnType<typeof useRegionFilters>;

export function RegionFilterBar({ regions, f, onHint }: { regions: Region[]; f: Filters; onHint?: (h: HintFilter) => void }) {
  const sggs = useMemo(() => [...new Set(regions.map((r) => r.sgg_nm))].sort(), [regions]);
  const countBy = (pred: (r: Region) => boolean) => regions.filter(pred).length;
  const pickHint = (h: HintFilter) => {
    f.setHint(h);
    onHint?.(h);
  };

  return (
    <section className="card toolbar" aria-label="필터">
      <div className="filter-row">
        <span className="filter-label">자치구</span>
        <Chip on={f.sgg === "all"} onClick={() => f.setSgg("all")} count={regions.length}>
          전체
        </Chip>
        {sggs.map((s) => (
          <Chip key={s} on={f.sgg === s} onClick={() => f.setSgg(s)} count={countBy((r) => r.sgg_nm === s)}>
            {s}
          </Chip>
        ))}
      </div>
      <div className="filter-row">
        <span className="filter-label">분류</span>
        <Chip on={f.cls === "all"} onClick={() => f.setCls("all")}>
          전체
        </Chip>
        <Chip on={f.cls === "A"} onClick={() => f.setCls("A")} dot="var(--accent)" count={countBy((r) => r.classification === "A")}>
          {CLASS_LABEL.A}
        </Chip>
        <Chip on={f.cls === "REF"} onClick={() => f.setCls("REF")} dot="var(--ref)" count={countBy((r) => r.classification !== "A")}>
          {CLASS_LABEL.REF}
        </Chip>
      </div>
      <div className="filter-row">
        <span className="filter-label">도로 여건</span>
        <Chip on={f.hint === "all"} onClick={() => pickHint("all")}>
          전체
        </Chip>
        {HINT_ORDER.map((h) => (
          <Chip key={h} on={f.hint === h} onClick={() => pickHint(h)} dot={`var(--hint-${h})`} count={countBy((r) => r.charger_hint === h)}>
            {HINT_LABEL[h]}
          </Chip>
        ))}
      </div>
      <div className="filter-row">
        <span className="filter-label">검색</span>
        <input type="search" placeholder="동 이름 (예: 잠실)" value={f.q} onChange={(e) => f.setQ(e.target.value)} aria-label="동 이름 검색" />
      </div>
    </section>
  );
}
