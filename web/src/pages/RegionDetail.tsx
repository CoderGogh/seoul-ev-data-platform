// 동네 검토 카드: 수요 축 + 도로 여건 + 현장 체크포인트
import type { CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GROWTH_DESC, REASON_LABEL, fmtInt, fmtMonth, fmtPct, type AppData, type Region } from "../data";
import { ClassBadge, HintBadge } from "../components/Badges";
import { RegionMap } from "../components/RegionMap";
import { Tip, chartTipStyle } from "../components/Tip";
import { Link, navigate } from "../router";

const axisProps = {
  stroke: "var(--axis)",
  tick: { fill: "var(--muted)", fontSize: 12 },
  tickLine: false,
};

// 현장 체크포인트 문구
function checkpoints(r: Region, lowFast: number, lowSlow: number): string[] {
  const out: string[] = [];
  if (r.charger_hint === "slow")
    out.push(`저속 비중 ${fmtPct(r.low_spd_ratio)}(${lowSlow}% 이상). 출퇴근 시간대 진입·대기 동선 확인`);
  if (r.charger_hint === "mixed")
    out.push(`저속 비중 ${fmtPct(r.low_spd_ratio)}(${lowFast}~${lowSlow}%). 시간대별 혼잡 구간 확인`);
  if (r.charger_hint === "fast")
    out.push(`저속 비중 ${fmtPct(r.low_spd_ratio)}(${lowFast}% 미만). 통행이 원활해 도로변 접근성 위주로 확인`);
  if (r.growth_pattern === "한 달 몰림") out.push("1년 증가분 대부분이 한 달에 몰림. 법인·렌터카 대량 등록 여부 확인");
  if (r.growth_pattern === "최근 가속") out.push("최근 3개월 증가가 빠름. 다음 등록 갱신 때 우선 확인");
  if (r.growth_pattern === "정체·변동") out.push("증가 흐름이 뚜렷하지 않음. 수요 지속 여부 확인");
  out.push("급속·완속 유형과 설치 위치는 현장 조사에서 결정");
  return out;
}

export function RegionDetail({ data, admCd }: { data: AppData; admCd: string }) {
  const r = data.regions.find((x) => x.adm_cd === admCd);
  if (!r) {
    return (
      <div className="empty">
        해당 행정동이 없습니다. <Link to="/regions">목록으로</Link>
      </div>
    );
  }
  const p = data.meta.threshold.params;
  const monthly = (data.monthly[admCd] ?? []).map((pt) => ({ month: fmtMonth(pt.base_month), ev_cnt: pt.ev_cnt }));
  const timeband = data.timeband[admCd] ?? [];
  const evPass = r.ev_cnt >= p.a_min_ev_cnt;
  const yoyPass = r.ev_yoy_rate != null && r.ev_yoy_rate >= p.a_min_yoy_rate;
  const evMax = Math.max(r.ev_cnt, p.a_min_ev_cnt) * 1.2;
  const yoyMax = Math.max(r.ev_yoy_rate ?? 0, p.a_min_yoy_rate) * 1.2;

  return (
    <div className="page">
      <section className="hero">
        <Link to="/regions" className="back">
          ← 행정동 목록
        </Link>
        <div className="kicker" style={{ marginTop: 14 }}>
          <span className="chip">{r.sgg_nm}</span>
          <span className="chip">행정동 코드 {r.adm_cd}</span>
        </div>
        <h1>{r.adm_nm}</h1>
        <div className="badges" style={{ marginTop: 10 }}>
          <ClassBadge value={r.classification} />
          <HintBadge value={r.charger_hint} prefix />
          {r.growth_pattern && <span className="badge">{r.growth_pattern}</span>}
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>수요</h2>
              <p className="card-sub">어디부터 볼지 정하는 축</p>
            </div>
          </div>
          <div className="metrics">
            <ThresholdMetric
              label="전기차 대수"
              value={`${fmtInt(r.ev_cnt)}대`}
              ratio={r.ev_cnt / evMax}
              mark={p.a_min_ev_cnt / evMax}
              pass={evPass}
              note={`기준 ${fmtInt(p.a_min_ev_cnt)}대 · 전년 동월 ${fmtInt(r.prev_ev_cnt)}대`}
            />
            <ThresholdMetric
              label="1년 증가율"
              value={fmtPct(r.ev_yoy_rate)}
              ratio={(r.ev_yoy_rate ?? 0) / yoyMax}
              mark={p.a_min_yoy_rate / yoyMax}
              pass={yoyPass}
              note={`기준 ${p.a_min_yoy_rate}% · 1년 +${fmtInt(r.ev_yoy_abs)}대`}
            />
            <div className="metric">
              <div className="metric-row">
                <span className="metric-label">전체 차량 중 전기차</span>
                <span className="metric-value">{fmtPct(r.ev_share)}</span>
              </div>
            </div>
            <div className="metric">
              <div className="metric-row">
                <span className="metric-label">증가 양상 (판정 미사용)</span>
                <span className="metric-value">{r.growth_pattern ?? "-"}</span>
              </div>
              {r.growth_pattern && <span className="metric-note">{GROWTH_DESC[r.growth_pattern]}</span>}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>도로 여건</h2>
              <p className="card-sub">현장에서 무엇을 볼지 정하는 축</p>
            </div>
          </div>
          <div className="metrics">
            <ThresholdMetric
              label="저속 비중 (15km/h 미만)"
              value={fmtPct(r.low_spd_ratio)}
              ratio={r.low_spd_ratio / 40}
              marks={[p.hint_fast_max_low / 40, p.hint_slow_min_low / 40]}
              color={r.charger_hint ? `var(--hint-${r.charger_hint})` : undefined}
              note={`원활 ${p.hint_fast_max_low}% 미만 · 혼잡 ${p.hint_slow_min_low}% 이상`}
            />
            <div className="metric">
              <div className="metric-row">
                <span className="metric-label">평균 속도 (도로 길이 가중)</span>
                <span className="metric-value">{r.avg_spd} km/h</span>
              </div>
            </div>
            <div className="metric">
              <div className="metric-row">
                <span className="metric-label">수집 도로</span>
                <span className="metric-value">
                  {r.link_cnt}개 링크 · {r.road_len_km}km
                </span>
              </div>
            </div>
            <div className="metric">
              <div className="metric-row">
                <span className="metric-label">관측 커버리지</span>
                <span className="metric-value">{fmtPct(r.coverage)}</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>월별 전기차 대수</h2>
              <p className="card-sub">점선은 우선 검토 기준 {fmtInt(p.a_min_ev_cnt)}대</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthly} margin={{ top: 8, right: 24, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="month" {...axisProps} interval={2} />
              <YAxis {...axisProps} width={48} tickFormatter={fmtInt} domain={[0, "auto"]} />
              <ReferenceLine y={p.a_min_ev_cnt} stroke="var(--muted)" strokeDasharray="4 4" ifOverflow="extendDomain" />
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
          <div className="card-head">
            <div>
              <h2>시간대별 평균 속도</h2>
              <p className="card-sub">확정된 주간 시간대만, km/h</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={timeband} margin={{ top: 8, right: 24, bottom: 0, left: 4 }} barCategoryGap={4}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="label" {...axisProps} tickFormatter={(v: string) => v.slice(0, 2)} />
              <YAxis {...axisProps} width={36} />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <Tip
                      style={chartTipStyle}
                      title={String(label)}
                      rows={[
                        ["평균 속도", `${payload[0].value} km/h`],
                        ["관측 링크", `${payload[0].payload.link_cnt}개`],
                      ]}
                    />
                  ) : null
                }
              />
              <Bar isAnimationActive={false} dataKey="avg_spd" fill="var(--accent)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2 style={{ marginBottom: 12 }}>현장 체크포인트</h2>
          <ul className="checklist">
            {checkpoints(r, p.hint_fast_max_low, p.hint_slow_min_low).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {r.reason_codes.length > 0 && (
            <div className="note" style={{ marginTop: 16 }}>
              데이터 참고
              <ul>
                {r.reason_codes.map((c) => (
                  <li key={c}>{REASON_LABEL[c] ?? c}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 12 }}>위치</h2>
          <RegionMap
            geo={data.geo}
            regions={data.regions.filter((x) => x.sgg_nm === r.sgg_nm)}
            mode="class"
            activeCd={r.adm_cd}
            onSelect={(cd) => navigate(`/regions/${cd}`)}
          />
        </section>
      </div>
    </div>
  );
}

interface ThresholdMetricProps {
  label: string;
  value: string;
  ratio: number;
  mark?: number;
  marks?: number[];
  pass?: boolean;
  color?: string;
  note: string;
}

// 기준선 대비 막대
function ThresholdMetric({ label, value, ratio, mark, marks, pass, color, note }: ThresholdMetricProps) {
  const all = marks ?? (mark != null ? [mark] : []);
  return (
    <div className="metric">
      <div className="metric-row">
        <span className="metric-label">{label}</span>
        <span className="metric-value">
          {value}
          {pass != null && <span className={`pass${pass ? "" : " no"}`}>{pass ? "기준 충족" : "기준 미달"}</span>}
        </span>
      </div>
      <div className="bar" aria-hidden="true">
        <div
          className="bar-fill"
          style={{ width: `${Math.min(ratio, 1) * 100}%`, ...(color ? ({ "--bar": color } as CSSProperties) : {}) }}
        />
        {all.map((m) => (
          <div key={m} className="bar-mark" style={{ left: `${Math.min(m, 1) * 100}%` }} />
        ))}
      </div>
      <span className="metric-note">{note}</span>
    </div>
  );
}
