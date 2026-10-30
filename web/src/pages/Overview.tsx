// 개요: 결과 요약·판정 기준·3개 구 추세
import { useMemo, type CSSProperties } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CLASS_LABEL,
  HINT_LABEL,
  HINT_ORDER,
  fmtDateTime,
  fmtInt,
  fmtMonth,
  fmtPct,
  type AppData,
  type Region,
} from "../data";
import { HintBadge } from "../components/Badges";
import { Tip, chartTipStyle } from "../components/Tip";
import { Link, navigate } from "../router";

const axisProps = {
  stroke: "var(--axis)",
  tick: { fill: "var(--muted)", fontSize: 12 },
  tickLine: false,
};

export function Overview({ data }: { data: AppData }) {
  const { regions, monthly, meta } = data;
  const p = meta.threshold.params;
  const priority = regions.filter((r) => r.classification === "A");
  const linkCnt = regions.reduce((s, r) => s + r.link_cnt, 0);

  // 3개 구 월별 합계
  const total = useMemo(() => {
    const sum = new Map<string, number>();
    Object.values(monthly).forEach((series) =>
      series.forEach((pt) => sum.set(pt.base_month, (sum.get(pt.base_month) ?? 0) + pt.ev_cnt)),
    );
    return [...sum.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => ({ month: fmtMonth(m), ev_cnt: v }));
  }, [monthly]);
  const growth = total.length > 1 ? (100 * (total[total.length - 1].ev_cnt - total[0].ev_cnt)) / total[0].ev_cnt : 0;

  const scatterA = regions.filter((r) => r.classification === "A" && r.ev_yoy_rate != null);
  const scatterRef = regions.filter((r) => r.classification !== "A" && r.ev_yoy_rate != null);

  return (
    <div className="page">
      <section className="hero">
        <div className="kicker">
          <span className="chip">등록 {fmtMonth(meta.base_month)}</span>
          <span className="chip">
            도로 {fmtDateTime(meta.traffic_window_start)} ~ {fmtDateTime(meta.traffic_window_end)} 관측
          </span>
        </div>
        <h1>
          충전소를 먼저 늘릴 동네 <span className="accent-num">{priority.length}곳</span>
        </h1>
        <p className="lede">
          강남·서초·송파 {regions.length}개 행정동을 전기차 대수와 1년 증가율로 골랐습니다. 동네마다 도로 여건을 함께
          붙였고, 급속·완속 유형은 현장 조사에서 정합니다.
        </p>
      </section>

      <section className="stats" aria-label="요약">
        <div className="stat">
          <div className="stat-value">{regions.length}개 동</div>
          <div className="stat-label">강남·서초·송파 분석 대상</div>
        </div>
        <div className="stat">
          <div className="stat-value">{fmtInt(linkCnt)}곳</div>
          <div className="stat-label">30분마다 수집한 도로 링크</div>
        </div>
        <div className="stat">
          <div className="stat-value accent-num">{priority.length}곳</div>
          <div className="stat-label">충전소 우선 검토 지역</div>
        </div>
        <div className="stat">
          <div className="stat-value">+{growth.toFixed(1)}%</div>
          <div className="stat-label">3개 구 전기차 1년 증가</div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>우선 검토 {priority.length}곳</h2>
            <p className="card-sub">전기차 대수 순. 왼쪽 띠 색은 도로 여건, 누르면 검토 카드로 이동</p>
          </div>
          <div className="badges">
            {HINT_ORDER.map((h) => (
              <span key={h} className={`badge badge-hint-${h}`}>
                {HINT_LABEL[h]} {priority.filter((r) => r.charger_hint === h).length}
              </span>
            ))}
          </div>
        </div>
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
                전기차 <b>{fmtInt(r.ev_cnt)}대</b> · 1년 <b>+{fmtPct(r.ev_yoy_rate)}</b>
              </span>
              <span>
                <HintBadge value={r.charger_hint} prefix />
              </span>
            </Link>
          ))}
        </div>
        <p style={{ marginTop: 14 }}>
          <Link to="/regions">전체 {regions.length}개 동 지도·목록 보기 →</Link>
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>판정 기준</h2>
            <p className="card-sub">
              전기차 {fmtInt(p.a_min_ev_cnt)}대 이상이면서 1년 증가율 {p.a_min_yoy_rate}% 이상이면 우선 검토 (67개 동 상위
              40% 경계, 잠정치)
            </p>
          </div>
          <div className="legend">
            <span>
              <i className="swatch" style={{ background: "var(--accent)", borderRadius: 999 }} />
              {CLASS_LABEL.A}
            </span>
            <span>
              <i className="swatch" style={{ background: "var(--ref)", borderRadius: 999 }} />
              {CLASS_LABEL.REF}
            </span>
            <span>
              <i className="swatch-line" />
              기준선
            </span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={360}>
          <ScatterChart margin={{ top: 12, right: 16, bottom: 24, left: 4 }}>
            <CartesianGrid stroke="var(--grid)" strokeDasharray="0" />
            <XAxis
              type="number"
              dataKey="ev_cnt"
              name="전기차"
              {...axisProps}
              tickFormatter={fmtInt}
              label={{ value: "전기차 대수", position: "insideBottom", offset: -14, fill: "var(--muted)", fontSize: 12 }}
            />
            <YAxis
              type="number"
              dataKey="ev_yoy_rate"
              name="1년 증가율"
              {...axisProps}
              width={48}
              unit="%"
            />
            <ReferenceLine x={p.a_min_ev_cnt} stroke="var(--muted)" strokeDasharray="4 4" />
            <ReferenceLine y={p.a_min_yoy_rate} stroke="var(--muted)" strokeDasharray="4 4" />
            <Tooltip cursor={false} content={<RegionTip />} />
            <Scatter
              isAnimationActive={false}
              data={scatterRef}
              fill="var(--ref)"
              stroke="var(--surface)"
              strokeWidth={2}
              cursor="pointer"
              onClick={(d: { payload?: Region }) => d.payload && navigate(`/regions/${d.payload.adm_cd}`)}
            />
            <Scatter
              isAnimationActive={false}
              data={scatterA}
              fill="var(--accent)"
              stroke="var(--surface)"
              strokeWidth={2}
              cursor="pointer"
              onClick={(d: { payload?: Region }) => d.payload && navigate(`/regions/${d.payload.adm_cd}`)}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>3개 구 전기차 대수</h2>
              <p className="card-sub">
                {total[0]?.month} {fmtInt(total[0]?.ev_cnt)}대 → {total[total.length - 1]?.month}{" "}
                {fmtInt(total[total.length - 1]?.ev_cnt)}대
              </p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={total} margin={{ top: 8, right: 24, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="month" {...axisProps} interval={2} />
              <YAxis {...axisProps} width={56} tickFormatter={fmtInt} domain={["auto", "auto"]} />
              <Tooltip
                cursor={{ stroke: "var(--axis)" }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <Tip style={chartTipStyle} title={String(label)} rows={[["전기차", `${fmtInt(Number(payload[0].value))}대`]]} />
                  ) : null
                }
              />
              <Line isAnimationActive={false} type="linear" dataKey="ev_cnt" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 12 }}>이렇게 봅니다</h2>
          <ul className="checklist">
            <li>
              <b>수요</b>: 전기차 대수와 1년 증가율이 모두 기준 이상인 동을 먼저 검토
            </li>
            <li>
              <b>도로 여건</b>: 15km/h 미만 저속 비중으로 원활(13% 미만)·보통·혼잡(22% 이상). 모든 차량 기준이라 수요
              판정에는 쓰지 않음
            </li>
            <li>
              <b>품질 관문</b>: 수집·실행·지역 3단계 점검을 통과한 결과만 공개.{" "}
              <Link to="/quality">데이터 품질 보기</Link>
            </li>
            <li>
              <b>유형 결정</b>: 급속·완속은 현장 조사 몫. 이 화면은 어디부터, 무엇을 보러 갈지를 정리
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function RegionTip({ active, payload }: { active?: boolean; payload?: { payload: Region }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <Tip
      style={chartTipStyle}
      title={`${r.sgg_nm} ${r.adm_nm}`}
      rows={[
        ["분류", CLASS_LABEL[r.classification]],
        ["전기차", `${fmtInt(r.ev_cnt)}대`],
        ["1년 증가율", fmtPct(r.ev_yoy_rate)],
      ]}
    />
  );
}
