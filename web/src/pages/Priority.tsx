// 우선 검토 지역: 동네 카드·기준 대비 여유·공급 충분 제외 동
import type { CSSProperties } from "react";
import { HINT_LABEL, HINT_ORDER, fmtInt, fmtPct, type AppData } from "../data";
import { HintBadge } from "../components/Badges";
import { CardHead, PageHead } from "../components/PageHead";
import { Link, navigate } from "../router";

export function Priority({ data }: { data: AppData }) {
  const p = data.meta.threshold.params;
  const priority = data.regions.filter((r) => r.classification === "A");

  return (
    <div className="page">
      <PageHead
        tags={["지역 분석"]}
        title={
          <>
            우선 검토 지역 <span className="accent-num">{priority.length}곳</span>
          </>
        }
        lede={`전기차 ${fmtInt(p.a_min_ev_cnt)}대 이상, 1년 증가율 ${p.a_min_yoy_rate}% 이상이면서 충전기 1대당 전기차가 ${p.a_min_ev_per_charger}대 이상(공급 부족)인 동입니다. 왼쪽 띠 색은 도로 여건입니다.`}
      >
        <div className="badges" style={{ marginTop: 14 }}>
          {HINT_ORDER.map((h) => (
            <span key={h} className={`badge badge-hint-${h}`}>
              {HINT_LABEL[h]} {priority.filter((r) => r.charger_hint === h).length}곳
            </span>
          ))}
        </div>
      </PageHead>

      <SupplyExcluded data={data} />

      <section className="card">
        <CardHead title="동네 카드" sub="누르면 검토 카드로 이동" />
        <div className="region-list">
          {priority.map((r) => (
            <Link
              key={r.adm_cd}
              to={`/regions/${r.adm_cd}`}
              className="region-item"
              style={r.charger_hint ? ({ "--rail": `var(--hint-${r.charger_hint})` } as CSSProperties) : undefined}
            >
              <span className="name">
                {r.adm_nm} <span className="metric-note">{r.sgg_nm}</span>
              </span>
              <span className="meta">
                전기차 <b>{fmtInt(r.ev_cnt)}대</b> · 1년 <b>+{fmtPct(r.ev_yoy_rate)}</b> · 충전기 1대당 <b>{r.ev_per_charger?.toFixed(1)}대</b>
              </span>
              <span>
                <HintBadge value={r.charger_hint} prefix />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card">
        <CardHead title="기준 대비 여유" sub={`전기차 기준 ${fmtInt(p.a_min_ev_cnt)}대, 증가율 기준 ${p.a_min_yoy_rate}%, 공급 부족 기준 1대당 ${p.a_min_ev_per_charger}대`} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>행정동</th>
                <th className="num">전기차</th>
                <th className="num">기준 대비</th>
                <th className="num">1년 증가율</th>
                <th className="num">기준 대비</th>
                <th className="num">충전기</th>
                <th className="num">1대당 전기차</th>
                <th>도로 여건</th>
                <th>증가 양상</th>
              </tr>
            </thead>
            <tbody>
              {priority.map((r) => (
                <tr key={r.adm_cd} className="clickable" onClick={() => navigate(`/regions/${r.adm_cd}`)}>
                  <td>
                    <b>{r.adm_nm}</b> <span className="metric-note">{r.sgg_nm}</span>
                  </td>
                  <td className="num">{fmtInt(r.ev_cnt)}</td>
                  <td className="num up">+{fmtInt(r.ev_cnt - p.a_min_ev_cnt)}대</td>
                  <td className="num">{fmtPct(r.ev_yoy_rate)}</td>
                  <td className="num up">+{((r.ev_yoy_rate ?? 0) - p.a_min_yoy_rate).toFixed(1)}%p</td>
                  <td className="num">{fmtInt(r.charger_cnt)}</td>
                  <td className="num">{r.ev_per_charger?.toFixed(1) ?? "-"}</td>
                  <td>
                    <HintBadge value={r.charger_hint} />
                  </td>
                  <td>{r.growth_pattern ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// v3 에서 공급 충분으로 빠진 동 (수요 기준은 통과)
function SupplyExcluded({ data }: { data: AppData }) {
  const out = data.regions.filter((r) => r.reason_codes.includes("supply_sufficient"));
  if (out.length === 0) return null;
  return (
    <section className="card">
      <CardHead title={`충전기가 이미 충분해 빠진 ${out.length}곳`} sub="전기차 대수·증가율 기준은 넘음 · 분류 v3부터 제외" />
      <div className="region-list">
        {out.map((r) => (
          <Link key={r.adm_cd} to={`/regions/${r.adm_cd}`} className="region-item">
            <span className="name">
              {r.adm_nm} <span className="metric-note">{r.sgg_nm}</span>
            </span>
            <span className="meta">
              전기차 <b>{fmtInt(r.ev_cnt)}대</b> · 충전기 <b>{fmtInt(r.charger_cnt)}대</b> · 1대당 <b>{r.ev_per_charger?.toFixed(1)}대</b>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
