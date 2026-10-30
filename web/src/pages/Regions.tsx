// 지도 + 목록: 구·분류 필터, 정렬 표
import { useMemo, useState } from "react";
import { CLASS_LABEL, fmtInt, fmtPct, type AppData, type Region } from "../data";
import { ClassBadge, HintBadge } from "../components/Badges";
import { RegionMap, type MapMode } from "../components/RegionMap";
import { Link, navigate } from "../router";

type ClassFilter = "all" | "A" | "REF";
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

export function Regions({ data }: { data: AppData }) {
  const { regions, geo } = data;
  const sggs = useMemo(() => [...new Set(regions.map((r) => r.sgg_nm))].sort(), [regions]);
  const [sgg, setSgg] = useState("all");
  const [cls, setCls] = useState<ClassFilter>("all");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<MapMode>("class");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "ev_cnt", desc: true });

  // 필터 적용
  const filtered = useMemo(
    () =>
      regions.filter(
        (r) =>
          (sgg === "all" || r.sgg_nm === sgg) &&
          (cls === "all" || (cls === "A" ? r.classification === "A" : r.classification !== "A")) &&
          (!q || r.adm_nm.includes(q.trim())),
      ),
    [regions, sgg, cls, q],
  );
  const matches = useMemo(() => new Set(filtered.map((r) => r.adm_cd)), [filtered]);
  const sorted = useMemo(() => {
    const out = [...filtered].sort((a, b) => compare(a, b, sort.key) || b.ev_cnt - a.ev_cnt);
    return sort.desc ? out.reverse() : out;
  }, [filtered, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "adm_nm" }));

  const open = (cd: string) => navigate(`/regions/${cd}`);

  return (
    <div className="page">
      <section>
        <div className="kicker">강남·서초·송파</div>
        <h1>행정동 {regions.length}곳</h1>
        <p className="lede">지도나 표에서 동네를 고르면 검토 카드로 이동합니다.</p>
      </section>

      <div className="filters" role="group" aria-label="필터">
        <select value={sgg} onChange={(e) => setSgg(e.target.value)} aria-label="자치구">
          <option value="all">전체 구</option>
          {sggs.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="segmented" aria-label="분류">
          {(["all", "A", "REF"] as ClassFilter[]).map((c) => (
            <button key={c} aria-pressed={cls === c} onClick={() => setCls(c)}>
              {c === "all" ? "전체" : CLASS_LABEL[c]}
            </button>
          ))}
        </div>
        <input type="search" placeholder="동 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="동 이름 검색" />
      </div>

      <section className="card">
        <div className="card-head">
          <h2>지도</h2>
          <div className="segmented" aria-label="지도 색상 기준">
            <button aria-pressed={mode === "class"} onClick={() => setMode("class")}>
              분류
            </button>
            <button aria-pressed={mode === "hint"} onClick={() => setMode("hint")}>
              도로 여건
            </button>
          </div>
        </div>
        <RegionMap geo={geo} regions={regions} mode={mode} matches={matches} onSelect={open} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>목록</h2>
          <span className="card-sub">{sorted.length}곳</span>
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
