// 대시보드: 핵심 수치·우선 검토 순위·지도·주목할 동네·요약
import { useMemo } from "react";
import { HINT_LABEL, fmtDateTime, fmtInt, fmtMonth, fmtPct, type AppData } from "../data";
import { hintCounts, monthlyTotals, nearMiss, watchList } from "../insights";
import { HintBadge } from "../components/Badges";
import { CardHead, PageHead } from "../components/PageHead";
import { RegionMap } from "../components/RegionMap";
import { TotalTrendChart } from "../components/charts";
import { Link, navigate } from "../router";

const More = ({ to, label = "자세히" }: { to: string; label?: string }) => (
  <Link to={to} className="more">
    {label} →
  </Link>
);

export function Dashboard({ data }: { data: AppData }) {
  const { regions, meta } = data;
  const p = meta.threshold.params;
  const priority = regions.filter((r) => r.classification === "A");
  const linkCnt = regions.reduce((s, r) => s + r.link_cnt, 0);
  const totals = useMemo(() => monthlyTotals(data), [data]);
  const growth = (100 * (totals[totals.length - 1].total - totals[0].total)) / totals[0].total;
  const near = nearMiss(regions, p.a_min_ev_cnt, p.a_min_yoy_rate);
  const watch = watchList(regions);
  const hints = hintCounts(regions);
  const maxHint = Math.max(...hints.map((h) => h.all));

  return (
    <div className="page">
      <PageHead
        tags={[`등록 ${fmtMonth(meta.base_month)}`, `도로 ${fmtDateTime(meta.traffic_window_start)} ~ ${fmtDateTime(meta.traffic_window_end)}`]}
        title={
          <>
            충전소를 먼저 늘릴 동네 <span className="accent-num">{priority.length}곳</span>
          </>
        }
        lede={`강남·서초·송파 ${regions.length}개 행정동을 전기차 대수와 1년 증가율로 골랐습니다. 동네마다 도로 여건을 함께 붙였고, 급속·완속 유형은 현장 조사에서 정합니다.`}
      />

      <section className="stats" aria-label="핵심 수치">
        <div className="stat">
          <div className="stat-value accent-num">{priority.length}곳</div>
          <div className="stat-label">충전소 우선 검토 지역</div>
        </div>
        <div className="stat">
          <div className="stat-value">+{growth.toFixed(1)}%</div>
          <div className="stat-label">3개 구 전기차 1년 증가</div>
        </div>
        <div className="stat">
          <div className="stat-value">{regions.length}개 동</div>
          <div className="stat-label">강남·서초·송파 분석 대상</div>
        </div>
        <div className="stat">
          <div className="stat-value">{fmtInt(linkCnt)}곳</div>
          <div className="stat-label">30분마다 수집한 도로 링크</div>
        </div>
      </section>

      <div className="grid-dash">
        <section className="card">
          <CardHead title="우선 검토 순위" sub="전기차 대수 순" action={<More to="/priority" />} />
          <ol className="rank">
            {priority.map((r, i) => (
              <li key={r.adm_cd}>
                <button className="rank-row" onClick={() => navigate(`/regions/${r.adm_cd}`)}>
                  <span className="rank-no">{i + 1}</span>
                  <span className="rank-name">
                    {r.adm_nm} <span className="metric-note">{r.sgg_nm}</span>
                  </span>
                  <span className="rank-num">
                    {fmtInt(r.ev_cnt)}대 · +{fmtPct(r.ev_yoy_rate)}
                  </span>
                  <HintBadge value={r.charger_hint} />
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="card">
          <CardHead title="한눈에 보는 위치" sub="파란 곳이 우선 검토" action={<More to="/map" label="큰 지도" />} />
          <RegionMap geo={data.geo} regions={regions} mode="class" height={420} onSelect={(cd) => navigate(`/regions/${cd}`)} />
        </section>
      </div>

      <section className="card">
        <CardHead title="주목할 동네" sub="다음 갱신 때 먼저 확인할 곳 (판정에는 미사용)" action={<More to="/criteria" />} />
        <div className="insights">
          <div className="insight">
            <div className="insight-title">
              <span className="insight-icon">↗</span>기준 근접
            </div>
            <p className="metric-note">기준 하나는 넘고 다른 하나도 80% 이상</p>
            {near.map(({ region, short }) => (
              <Link key={region.adm_cd} to={`/regions/${region.adm_cd}`} className="insight-row">
                <b>{region.adm_nm}</b>
                <span>{short}</span>
              </Link>
            ))}
          </div>
          <div className="insight">
            <div className="insight-title">
              <span className="insight-icon">⚡</span>증가 양상 주의
            </div>
            <p className="metric-note">한 달 몰림·최근 가속</p>
            {watch.map((r) => (
              <Link key={r.adm_cd} to={`/regions/${r.adm_cd}`} className="insight-row">
                <b>{r.adm_nm}</b>
                <span>{r.growth_pattern}</span>
              </Link>
            ))}
          </div>
          <div className="insight">
            <div className="insight-title">
              <span className="insight-icon">🛣</span>우선 검토 도로 여건
            </div>
            <p className="metric-note">현장 조사 때 볼 포인트</p>
            {hints.map((h) => (
              <div key={h.hint} className="insight-row static">
                <span className={`badge badge-hint-${h.hint}`}>{HINT_LABEL[h.hint]}</span>
                <span>
                  {h.priority}곳{" "}
                  {priority
                    .filter((r) => r.charger_hint === h.hint)
                    .map((r) => r.adm_nm)
                    .join(", ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid-3">
        <section className="card">
          <CardHead title="전기차 추세" sub={`${totals[0].month} → ${totals[totals.length - 1].month}`} action={<More to="/trend" />} />
          <TotalTrendChart data={totals} height={180} />
        </section>

        <section className="card">
          <CardHead title="도로 여건 분포" sub={`${regions.length}개 동`} action={<More to="/road" />} />
          <div className="hbars">
            {hints.map((h) => (
              <div key={h.hint} className="hbar">
                <span className="hbar-label">{HINT_LABEL[h.hint]}</span>
                <span className="hbar-track">
                  <span className="hbar-fill" style={{ width: `${(100 * h.all) / maxHint}%`, background: `var(--hint-${h.hint})` }} />
                </span>
                <span className="hbar-num">{h.all}곳</span>
              </div>
            ))}
          </div>
          <p className="metric-note" style={{ marginTop: 12 }}>
            저속 비중 {p.hint_fast_max_low}% 미만 원활 · {p.hint_slow_min_low}% 이상 혼잡
          </p>
        </section>

        <section className="card">
          <CardHead title="데이터 상태" sub="품질 관문 통과분만 공개" action={<More to="/quality" />} />
          <dl className="kv">
            <dt>게시</dt>
            <dd>
              <span className="pass">{meta.publish_status === "current" ? "최신 게시" : meta.publish_status}</span>
            </dd>
            <dt>게시 시각</dt>
            <dd>{fmtDateTime(meta.published_at)}</dd>
            <dt>수집 응답률</dt>
            <dd>{meta.poll.ok_ratio}%</dd>
            <dt>품질 정상</dt>
            <dd>
              {regions.filter((r) => r.quality_grade === "ok").length} / {regions.length}개 동
            </dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
