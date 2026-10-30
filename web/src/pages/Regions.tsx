// 행정동 목록: 필터·정렬 표
import { useMemo, useState } from "react";
import { fmtInt, fmtPct, type AppData, type Region } from "../data";
import { ClassBadge, HintBadge } from "../components/Badges";
import { PageHead } from "../components/PageHead";
import { RegionFilterBar, useRegionFilters } from "../components/RegionFilters";
import { Link, navigate } from "../router";

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
  const { regions } = data;
  const f = useRegionFilters(regions);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "ev_cnt", desc: true });

  const sorted = useMemo(() => {
    const out = [...f.filtered].sort((a, b) => compare(a, b, sort.key) || b.ev_cnt - a.ev_cnt);
    return sort.desc ? out.reverse() : out;
  }, [f.filtered, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "adm_nm" }));

  const open = (cd: string) => navigate(`/regions/${cd}`);

  return (
    <div className="page">
      <PageHead tags={["지역 분석"]} title={`행정동 목록 ${regions.length}곳`} lede="조건으로 좁히고 머리글로 정렬합니다. 행을 누르면 검토 카드로 이동합니다." />

      <RegionFilterBar regions={regions} f={f} />

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
