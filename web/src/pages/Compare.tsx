// 동 비교: 2~3개 동 지표·판정 나란히 (선택은 주소 ?ids= 에 유지)
import { useEffect, useMemo, useState } from "react";
import { CLASS_LABEL, fmtInt, fmtPct, type AppData, type Region } from "../data";
import { CardHead, PageHead } from "../components/PageHead";
import { ClassBadge } from "../components/Badges";
import { Link } from "../router";
import { verdict } from "../verdict";

const MAX = 3;

const ROWS: [string, (r: Region) => string][] = [
  ["분류", (r) => CLASS_LABEL[r.classification]],
  ["전기차", (r) => `${fmtInt(r.ev_cnt)}대`],
  ["1년 증가율", (r) => fmtPct(r.ev_yoy_rate)],
  ["전기차 비중", (r) => fmtPct(r.ev_share)],
  ["충전기 (급속)", (r) => (r.charger_cnt == null ? "-" : `${fmtInt(r.charger_cnt)}대 (${fmtInt(r.fast_cnt)})`)],
  ["충전기 1대당 전기차", (r) => (r.ev_per_charger == null ? "-" : `${r.ev_per_charger.toFixed(1)}대`)],
  ["저속 비중", (r) => fmtPct(r.low_spd_ratio)],
  ["도로 여건", (r) => r.charger_hint_nm ?? "-"],
  ["평균 속도", (r) => `${r.avg_spd} km/h`],
  ["관측 커버리지", (r) => fmtPct(r.coverage)],
  ["증가 양상", (r) => r.growth_pattern ?? "-"],
];

// 주소 ?ids=a,b 읽기
export function parseIds(search: string, valid: Set<string>): string[] {
  const raw = new URLSearchParams(search).get("ids") ?? "";
  return [...new Set(raw.split(",").filter((c) => valid.has(c)))].slice(0, MAX);
}

export function Compare({ data }: { data: AppData }) {
  const { regions } = data;
  const byCd = useMemo(() => new Map(regions.map((r) => [r.adm_cd, r])), [regions]);
  const [ids, setIds] = useState(() => parseIds(window.location.search, new Set(byCd.keys())));
  const [query, setQuery] = useState("");
  const p = data.meta.threshold.params;

  // 선택 → 주소 반영 (새로고침·공유 유지)
  useEffect(() => {
    const qs = ids.length ? `?ids=${ids.join(",")}` : "";
    window.history.replaceState(null, "", `/compare${qs}`);
  }, [ids]);

  const picked = ids.map((c) => byCd.get(c)!).filter(Boolean);
  const options = regions
    .filter((r) => !ids.includes(r.adm_cd) && `${r.sgg_nm} ${r.adm_nm}`.includes(query.trim()))
    .sort((a, b) => a.adm_nm.localeCompare(b.adm_nm, "ko"));

  return (
    <div className="page">
      <PageHead tags={["지역 분석"]} title="동 비교" lede={`최대 ${MAX}곳까지 골라 지표와 판정을 나란히 봅니다.`} />

      <section className="card card-body">
        <CardHead title={`선택 ${picked.length} / ${MAX}`} sub="이름으로 찾아 추가" />
        <div className="compare-picked">
          {picked.map((r) => (
            <span key={r.adm_cd} className="chip">
              {r.sgg_nm} {r.adm_nm}
              <button type="button" aria-label={`${r.adm_nm} 빼기`} onClick={() => setIds(ids.filter((c) => c !== r.adm_cd))}>
                ×
              </button>
            </span>
          ))}
        </div>
        {picked.length < MAX && (
          <div className="compare-search">
            <input
              type="search"
              className="form-control form-control-sm"
              placeholder="동 이름 (예: 잠실)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="비교할 동 검색"
            />
            {query.trim() && (
              <ul className="compare-options">
                {options.slice(0, 8).map((r) => (
                  <li key={r.adm_cd}>
                    <button
                      type="button"
                      onClick={() => {
                        setIds([...ids, r.adm_cd]);
                        setQuery("");
                      }}
                    >
                      {r.sgg_nm} {r.adm_nm} <ClassBadge value={r.classification} />
                    </button>
                  </li>
                ))}
                {options.length === 0 && <li className="muted">없음</li>}
              </ul>
            )}
          </div>
        )}
      </section>

      {picked.length >= 2 ? (
        <section className="card card-body">
          <CardHead title="지표 비교" />
          <div className="table-wrap">
            <table className="table table-hover align-middle mb-0 compare-table">
              <thead>
                <tr>
                  <th />
                  {picked.map((r) => (
                    <th key={r.adm_cd}>
                      <Link to={`/regions/${r.adm_cd}`}>{r.adm_nm}</Link>
                      <div className="muted">{r.sgg_nm}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([label, f]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {picked.map((r) => (
                      <td key={r.adm_cd} className="num">
                        {f(r)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row">판정 근거</th>
                  {picked.map((r) => (
                    <td key={r.adm_cd} className="compare-verdict">
                      {verdict(r, p).summary}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="empty">2곳 이상 고르면 비교표가 나옵니다.</div>
      )}
    </div>
  );
}
