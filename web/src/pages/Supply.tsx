// 충전기 공급: 구별 요약·동별 공급 표·수집 품질 (ev04, 분류 미반영)
import { useMemo, useState } from "react";
import { fmtDate, fmtDateTime, fmtInt, fmtPct, type AppData, type ChargerDong } from "../data";
import { ClassBadge } from "../components/Badges";
import { CardHead, PageHead } from "../components/PageHead";
import { Link, navigate } from "../router";

type SortKey = "adm_nm" | "ev_per_charger" | "ev_per_fast" | "chargers" | "fast" | "ev_cnt";

const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "adm_nm", label: "행정동" },
  { key: "ev_cnt", label: "전기차", num: true },
  { key: "chargers", label: "충전기", num: true },
  { key: "fast", label: "급속", num: true },
  { key: "ev_per_charger", label: "충전기 1대당 전기차", num: true },
  { key: "ev_per_fast", label: "급속 1대당 전기차", num: true },
];

const STATUS_LABEL: Record<string, string> = {
  assigned: "대상 구 행정동 귀속",
  outside: "서울 경계 밖 좌표",
  sgg_mismatch: "다른 구 좌표 (원천 좌표 오류)",
};

const CHECK_LABEL: Record<string, string> = {
  total_reconcile: "원천 건수 = 적재 건수",
  assign_rate: "행정동 귀속률",
  quarantine_ratio: "격리 비율 (키·좌표 오류)",
  close_ratio: "직전 대비 소멸 비율",
};

function compare(a: ChargerDong, b: ChargerDong, key: SortKey) {
  if (key === "adm_nm") return a.adm_nm.localeCompare(b.adm_nm, "ko");
  return (a[key] ?? -Infinity) - (b[key] ?? -Infinity);
}

export function Supply({ data }: { data: AppData }) {
  const c = data.chargers;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "ev_per_charger", desc: true });
  const sorted = useMemo(() => {
    if (!c) return [];
    const out = [...c.by_dong].sort((a, b) => compare(a, b, sort.key));
    return sort.desc ? out.reverse() : out;
  }, [c, sort]);

  if (!c) return <div className="empty">충전기 데이터가 아직 없습니다.</div>;

  const total = c.by_sgg.reduce(
    (s, g) => ({ chargers: s.chargers + g.chargers, fast: s.fast + g.fast, open: s.open + g.open_cnt, ev: s.ev + g.ev_cnt }),
    { chargers: 0, fast: 0, open: 0, ev: 0 },
  );
  const priority = c.by_dong.filter((d) => d.classification === "A");
  const avg = total.ev / total.chargers;
  const gap = [...priority].sort((a, b) => (b.ev_per_charger ?? 0) - (a.ev_per_charger ?? 0));
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "adm_nm" }));
  const statusTotal = Object.values(c.status).reduce((s, n) => s + n, 0);

  return (
    <div className="page">
      <PageHead
        tags={["지표 분석", `수집 ${fmtDate(c.snapshot_date)}`, "ev04 · core.charger"]}
        title="충전기 공급"
        lede="충전기 공급을 매일 수집해서 분류 v3에 반영합니다. 전기차가 많고 빠르게 늘어도 충전기가 이미 충분하면 우선 검토에서 뺍니다. 표는 최신 수집 기준이고, 분류는 기준월 공급 기준일(첫 수집일 11월 2일) 기준입니다."
      />

      <section className="stats" aria-label="공급 요약">
        <div className="stat">
          <div className="stat-value">{fmtInt(total.chargers)}대</div>
          <div className="stat-label">3개 구 충전기 (행정동 귀속분)</div>
        </div>
        <div className="stat">
          <div className="stat-value">{fmtInt(total.fast)}대</div>
          <div className="stat-label">급속 (출력 50kW 이상) {fmtPct((100 * total.fast) / total.chargers)}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{fmtPct((100 * total.open) / total.chargers, 0)}</div>
          <div className="stat-label">누구나 쓸 수 있는 충전기 (이용 제한 없음)</div>
        </div>
        <div className="stat">
          <div className="stat-value">{avg.toFixed(1)}대</div>
          <div className="stat-label">충전기 1대당 전기차 (3개 구 평균)</div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <CardHead title={`우선 검토 ${priority.length}곳의 공급`} sub={`충전기 1대당 전기차 기준 ${data.meta.threshold.params.a_min_ev_per_charger ?? "-"}대 이상 · 3개 구 평균 ${avg.toFixed(1)}대`} />
          <ol className="rank">
            {gap.map((d, i) => (
              <li key={d.adm_cd}>
                <button className="rank-row" onClick={() => navigate(`/regions/${d.adm_cd}`)}>
                  <span className="rank-no">{i + 1}</span>
                  <span className="rank-name">
                    {d.adm_nm} <span className="metric-note">{d.sgg_nm}</span>
                  </span>
                  <span className="rank-num">
                    1대당 {d.ev_per_charger?.toFixed(1)}대 · 충전기 {fmtInt(d.chargers)}대
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="metric-note" style={{ marginTop: 12 }}>
            수요 기준은 넘었지만 충전기가 충분해 빠진 곳은 우선 검토 지역 화면에 따로 있습니다.
          </p>
        </section>

        <section className="card">
          <CardHead title="구별 공급" />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>구</th>
                  <th className="num">충전소</th>
                  <th className="num">충전기</th>
                  <th className="num">급속</th>
                  <th className="num">1대당 전기차</th>
                </tr>
              </thead>
              <tbody>
                {c.by_sgg.map((g) => (
                  <tr key={g.sgg_nm}>
                    <td>{g.sgg_nm}</td>
                    <td className="num">{fmtInt(g.stations)}</td>
                    <td className="num">{fmtInt(g.chargers)}</td>
                    <td className="num">{fmtInt(g.fast)}</td>
                    <td className="num">{(g.ev_cnt / g.chargers).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>행정동별 공급</h2>
          <span className="card-sub">{sorted.length}곳 · 머리글을 누르면 정렬 · 전기차는 2026년 9월 등록 기준</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} className={col.num ? "num" : undefined} aria-sort={sort.key === col.key ? (sort.desc ? "descending" : "ascending") : undefined}>
                    <button onClick={() => toggleSort(col.key)}>
                      {col.label}
                      {sort.key === col.key ? (sort.desc ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                ))}
                <th>분류</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.adm_cd} className="clickable" onClick={(e) => !(e.target as HTMLElement).closest("a") && navigate(`/regions/${d.adm_cd}`)}>
                  <td>
                    <Link to={`/regions/${d.adm_cd}`}>{d.adm_nm}</Link> <span className="metric-note">{d.sgg_nm}</span>
                  </td>
                  <td className="num">{fmtInt(d.ev_cnt)}</td>
                  <td className="num">{fmtInt(d.chargers)}</td>
                  <td className="num">{fmtInt(d.fast)}</td>
                  <td className="num">{d.ev_per_charger?.toFixed(1) ?? "-"}</td>
                  <td className="num">{d.ev_per_fast?.toFixed(0) ?? "급속 없음"}</td>
                  <td>
                    <ClassBadge value={d.classification} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <CardHead title="수집 품질" sub={`${fmtDateTime(c.loaded_at)} 적재 · 등급 ${c.load.quality_grade === "ok" ? "정상" : c.load.quality_grade}`} />
          <div className="table-wrap">
            <table>
              <tbody>
                {c.quality.map((q) => (
                  <tr key={`${q.check}-${q.scope}`}>
                    <td>
                      {CHECK_LABEL[q.check] ?? q.check} {q.scope !== "*" && <span className="metric-note">{q.scope}</span>}
                    </td>
                    <td className="num">
                      {q.check === "total_reconcile" ? `${fmtInt(q.metric)} / ${fmtInt(q.threshold)}` : `${fmtPct((q.metric ?? 0) * 100)} (기준 ${fmtPct((q.threshold ?? 0) * 100, 0)})`}
                    </td>
                    <td>
                      <span className={`badge tone-${q.grade === "ok" ? "ok" : "warn"}`}>{q.grade === "ok" ? "통과" : q.grade}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <CardHead title="좌표 귀속" sub={`현재 충전기 ${fmtInt(statusTotal)}대`} />
          <div className="hbars">
            {Object.entries(c.status)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <div key={k} className="hbar">
                  <span className="hbar-label">{STATUS_LABEL[k] ?? k}</span>
                  <span className="hbar-track">
                    <span className="hbar-fill" style={{ width: `${Math.max(1, (100 * n) / statusTotal)}%`, background: k === "assigned" ? "var(--good)" : "var(--ref)" }} />
                  </span>
                  <span className="hbar-num">{fmtInt(n)}</span>
                </div>
              ))}
          </div>
          <p className="note" style={{ marginTop: 14 }}>
            주소는 대상 구인데 좌표가 다른 구에 찍힌 충전기는 공급 집계에서 뺍니다. 서로 다른 아파트 두 곳이 같은 상암동 좌표를 가진 경우가 있었습니다.
          </p>
          <p className="metric-note" style={{ marginTop: 10 }}>출처: {c.source} · 공공누리 제1유형</p>
        </section>
      </div>
    </div>
  );
}
