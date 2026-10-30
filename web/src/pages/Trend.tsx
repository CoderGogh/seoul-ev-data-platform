// 전기차 추세: 3개 구 합계·구별 추세·증가 양상
import { useMemo } from "react";
import { GROWTH_DESC, fmtInt, type AppData } from "../data";
import { monthlyTotals } from "../insights";
import { CardHead, PageHead } from "../components/PageHead";
import { GuTrendChart, SGG_COLORS, TotalTrendChart } from "../components/charts";
import { Link } from "../router";

const PATTERNS = ["꾸준한 증가", "최근 가속", "한 달 몰림", "정체·변동"];

export function Trend({ data }: { data: AppData }) {
  const { regions } = data;
  const totals = useMemo(() => monthlyTotals(data), [data]);
  const sggs = useMemo(() => [...new Set(regions.map((r) => r.sgg_nm))].sort(), [regions]);
  const first = totals[0];
  const last = totals[totals.length - 1];

  return (
    <div className="page">
      <PageHead
        tags={["지표 분석", `${first.month} ~ ${last.month}`]}
        title="전기차 추세"
        lede={`3개 구 전기차는 ${fmtInt(first.total)}대에서 ${fmtInt(last.total)}대로 늘었습니다. 증가 양상은 참고용이며 분류 판정에는 쓰지 않습니다.`}
      />

      <section className="stats" aria-label="자치구별 증가">
        {sggs.map((s) => (
          <div className="stat" key={s}>
            <div className="stat-value">+{((100 * (last[s] - first[s])) / first[s]).toFixed(1)}%</div>
            <div className="stat-label">
              {s} {fmtInt(first[s])} → {fmtInt(last[s])}대
            </div>
          </div>
        ))}
        <div className="stat">
          <div className="stat-value accent-num">+{((100 * (last.total - first.total)) / first.total).toFixed(1)}%</div>
          <div className="stat-label">3개 구 합계</div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <CardHead title="3개 구 합계" sub="월별 등록 전기차" />
          <TotalTrendChart data={totals} height={280} />
        </section>
        <section className="card">
          <CardHead
            title="자치구별"
            sub="선 끝에 구 이름 표시"
            action={
              <div className="legend">
                {sggs.map((s, i) => (
                  <span key={s}>
                    <i className="swatch" style={{ background: SGG_COLORS[i] }} />
                    {s}
                  </span>
                ))}
              </div>
            }
          />
          <GuTrendChart data={totals} sggs={sggs} height={280} />
        </section>
      </div>

      <section className="card">
        <CardHead title="증가 양상" sub="최근 12개월 월별 증가 모양으로 묶음" />
        <div className="patterns">
          {PATTERNS.map((pt) => {
            const list = regions.filter((r) => r.growth_pattern === pt);
            return (
              <div key={pt} className="pattern">
                <div className="pattern-head">
                  <b>{pt}</b>
                  <span className="pattern-count">{list.length}곳</span>
                </div>
                <p className="metric-note">{GROWTH_DESC[pt]}</p>
                <div className="pattern-list">
                  {list.map((r) => (
                    <Link key={r.adm_cd} to={`/regions/${r.adm_cd}`} className={`tag${r.classification === "A" ? " tag-a" : ""}`}>
                      {r.adm_nm}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="metric-note" style={{ marginTop: 12 }}>
          파란 이름은 우선 검토 지역
        </p>
      </section>
    </div>
  );
}
