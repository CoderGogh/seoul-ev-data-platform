// 지도 + 목록: 구·분류·도로 여건 필터, 정렬 표
import { useMemo, useState, type ReactNode } from "react";
import { CLASS_LABEL, HINT_LABEL, HINT_ORDER, fmtInt, fmtPct, type AppData, type ChargerHint, type Region } from "../data";
import { ClassBadge, HintBadge } from "../components/Badges";
import { RegionMap, type MapMode } from "../components/RegionMap";
import { Link, navigate } from "../router";

type ClassFilter = "all" | "A" | "REF";
type HintFilter = "all" | ChargerHint;
type SortKey = "adm_nm" | "ev_cnt" | "ev_yoy_rate" | "low_spd_ratio" | "classification";

const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "adm_nm", label: "행정동" },
  { key: "classification", label: "분류" },
  { key: "ev_cnt", label: "전기차", num: true },
  { key: "ev_yoy_rate", label: "1년 증가율", num: true },
  { key: "low_spd_ratio", label: "저속 비중", num: true },
];

function compare(a: Region, b: Region, key: SortKey) {
  if (key === "adm_nm") return a.adm_nm.localeCompare(b.adm_nm, "ko");
  if (key === "classification") return (a.classification === "A" ? 0 : 1) - (b.classification === "A" ? 0 : 1);
  return (a[key] ?? -Infinity) - (b[key] ?? -Infinity);
}

interface ChipProps {
  on: boolean;
  onClick: () => void;
  count?: number;
  dot?: string;
  children: ReactNode;
}

function Chip({ on, onClick, count, dot, children }: ChipProps) {
  return (
    <button className="chip-btn" aria-pressed={on} onClick={onClick}>
      {dot && <i className="dot" style={{ background: dot }} />}
      {children}
      {count != null && <span className="count">{count}</span>}
    </button>
  );
}

export function Regions({ data }: { data: AppData }) {
  const { regions, geo } = data;
  const sggs = useMemo(() => [...new Set(regions.map((r) => r.sgg_nm))].sort(), [regions]);
  const [sgg, setSgg] = useState("all");
  const [cls, setCls] = useState<ClassFilter>("all");
  const [hint, setHint] = useState<HintFilter>("all");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<MapMode>("class");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "ev_cnt", desc: true });

  // 항목별 개수
  const countBy = (pred: (r: Region) => boolean) => regions.filter(pred).length;

  // 필터 적용
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
  const matches = useMemo(() => new Set(filtered.map((r) => r.adm_cd)), [filtered]);
  const sorted = useMemo(() => {
    const out = [...filtered].sort((a, b) => compare(a, b, sort.key) || b.ev_cnt - a.ev_cnt);
    return sort.desc ? out.reverse() : out;
  }, [filtered, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "adm_nm" }));

  // 도로 여건 필터 선택 시 지도도 도로 여건 색으로
  const pickHint = (h: HintFilter) => {
    setHint(h);
    if (h !== "all") setMode("hint");
  };

  const open = (cd: string) => navigate(`/regions/${cd}`);

  return (
    <div className="page">
      <section className="hero">
        <div className="kicker">
          <span className="chip">강남·서초·송파</span>
        </div>
        <h1>행정동 {regions.length}곳 한눈에 보기</h1>
        <p className="lede">조건으로 좁혀 보고, 지도나 표에서 동네를 누르면 검토 카드로 이동합니다.</p>
      </section>

      <section className="card toolbar" aria-label="필터">
        <div className="filter-row">
          <span className="filter-label">자치구</span>
          <Chip on={sgg === "all"} onClick={() => setSgg("all")} count={regions.length}>
            전체
          </Chip>
          {sggs.map((s) => (
            <Chip key={s} on={sgg === s} onClick={() => setSgg(s)} count={countBy((r) => r.sgg_nm === s)}>
              {s}
            </Chip>
          ))}
        </div>
        <div className="filter-row">
          <span className="filter-label">분류</span>
          <Chip on={cls === "all"} onClick={() => setCls("all")}>
            전체
          </Chip>
          <Chip on={cls === "A"} onClick={() => setCls("A")} dot="var(--accent)" count={countBy((r) => r.classification === "A")}>
            {CLASS_LABEL.A}
          </Chip>
          <Chip on={cls === "REF"} onClick={() => setCls("REF")} dot="var(--ref)" count={countBy((r) => r.classification !== "A")}>
            {CLASS_LABEL.REF}
          </Chip>
        </div>
        <div className="filter-row">
          <span className="filter-label">도로 여건</span>
          <Chip on={hint === "all"} onClick={() => pickHint("all")}>
            전체
          </Chip>
          {HINT_ORDER.map((h) => (
            <Chip key={h} on={hint === h} onClick={() => pickHint(h)} dot={`var(--hint-${h})`} count={countBy((r) => r.charger_hint === h)}>
              {HINT_LABEL[h]}
            </Chip>
          ))}
        </div>
        <div className="filter-row">
          <span className="filter-label">검색</span>
          <input type="search" placeholder="동 이름 (예: 잠실)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="동 이름 검색" />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>지도</h2>
            <p className="card-sub">조건에 맞는 동만 진하게 표시</p>
          </div>
          <div className="filter-row" aria-label="지도 색상 기준">
            <Chip on={mode === "class"} onClick={() => setMode("class")}>
              분류로 색칠
            </Chip>
            <Chip on={mode === "hint"} onClick={() => setMode("hint")}>
              도로 여건으로 색칠
            </Chip>
          </div>
        </div>
        <RegionMap geo={geo} regions={regions} mode={mode} matches={matches} onSelect={open} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>목록</h2>
          <span className="card-sub">{sorted.length}곳 · 머리글을 누르면 정렬</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={c.num ? "num" : undefined}
                    aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}
                  >
                    <button onClick={() => toggleSort(c.key)}>
                      {c.label}
                      {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                ))}
                <th>도로 여건</th>
                <th>증가 양상</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.adm_cd}
                  className="clickable"
                  onClick={(e) => {
                    // 링크 클릭은 Link 가 처리
                    if (!(e.target as HTMLElement).closest("a")) open(r.adm_cd);
                  }}
                >
                  <td>
                    <Link to={`/regions/${r.adm_cd}`}>{r.adm_nm}</Link>{" "}
                    <span className="metric-note">{r.sgg_nm}</span>
                  </td>
                  <td>
                    <ClassBadge value={r.classification} />
                  </td>
                  <td className="num">{fmtInt(r.ev_cnt)}</td>
                  <td className="num">{fmtPct(r.ev_yoy_rate)}</td>
                  <td className="num">{fmtPct(r.low_spd_ratio)}</td>
                  <td>
                    <HintBadge value={r.charger_hint} />
                  </td>
                  <td>{r.growth_pattern ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && <div className="empty">조건에 맞는 동이 없습니다.</div>}
        </div>
      </section>
    </div>
  );
}
