// 공용 차트 (recharts, 애니메이션 없음)
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { CLASS_LABEL, fmtInt, fmtPct, type Region } from "../data";
import { navigate } from "../router";
import { Tip, chartTipStyle } from "./Tip";

export const axisProps = {
  stroke: "var(--axis)",
  tick: { fill: "var(--muted)", fontSize: 12 },
  tickLine: false,
};

// 3개 구 합계 추세
export function TotalTrendChart({ data, height = 240 }: { data: { month: string; total: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 24, bottom: 0, left: 4 }}>
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
        <Line isAnimationActive={false} type="linear" dataKey="total" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// 자치구별 추세 (구 3개, 범례·끝 라벨 병기)
export const SGG_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

// 끝값이 가까운 선은 라벨을 위아래로 벌림
function labelOffsets(data: Record<string, number | string>[], sggs: string[]) {
  const last = data[data.length - 1] ?? {};
  const vals = sggs.map((s) => Number(last[s] ?? 0));
  const span = Math.max(...data.flatMap((row) => sggs.map((s) => Number(row[s] ?? 0)))) - Math.min(...vals);
  const order = sggs.map((s, i) => ({ s, v: vals[i] })).sort((a, b) => b.v - a.v);
  const dy: Record<string, number> = Object.fromEntries(sggs.map((s) => [s, 4]));
  for (let k = 1; k < order.length; k++) {
    if (Math.abs(order[k - 1].v - order[k].v) < span * 0.08) {
      dy[order[k - 1].s] = -4;
      dy[order[k].s] = 14;
    }
  }
  return dy;
}

export function GuTrendChart({ data, sggs, height = 300 }: { data: Record<string, number | string>[]; sggs: string[]; height?: number }) {
  const dy = labelOffsets(data, sggs);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 56, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="month" {...axisProps} interval={2} />
        <YAxis {...axisProps} width={56} tickFormatter={fmtInt} domain={["auto", "auto"]} />
        <Tooltip
          cursor={{ stroke: "var(--axis)" }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <Tip
                style={chartTipStyle}
                title={String(label)}
                rows={payload.map((p) => [String(p.dataKey), `${fmtInt(Number(p.value))}대`] as [string, string])}
              />
            ) : null
          }
        />
        {sggs.map((s, i) => (
          <Line
            key={s}
            isAnimationActive={false}
            type="linear"
            dataKey={s}
            stroke={SGG_COLORS[i]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            label={({ x, y, index }: { x: number; y: number; index: number }) =>
              index === data.length - 1 ? (
                <text x={x + 6} y={y + dy[s]} fontSize={12} fill="var(--text-2)">
                  {s}
                </text>
              ) : (
                <g />
              )
            }
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// 판정 기준 산점도 (점 클릭 시 검토 카드)
export function CriteriaScatter({ regions, minEv, minYoy, height = 360 }: { regions: Region[]; minEv: number; minYoy: number; height?: number }) {
  const withRate = regions.filter((r) => r.ev_yoy_rate != null);
  const open = (d: { payload?: Region }) => d.payload && navigate(`/regions/${d.payload.adm_cd}`);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 12, right: 16, bottom: 24, left: 4 }}>
        <CartesianGrid stroke="var(--grid)" />
        <XAxis
          type="number"
          dataKey="ev_cnt"
          name="전기차"
          {...axisProps}
          tickFormatter={fmtInt}
          label={{ value: "전기차 대수", position: "insideBottom", offset: -14, fill: "var(--muted)", fontSize: 12 }}
        />
        <YAxis type="number" dataKey="ev_yoy_rate" name="1년 증가율" {...axisProps} width={48} unit="%" />
        <ReferenceLine x={minEv} stroke="var(--muted)" strokeDasharray="4 4" />
        <ReferenceLine y={minYoy} stroke="var(--muted)" strokeDasharray="4 4" />
        <Tooltip cursor={false} content={<RegionTip />} />
        <Scatter
          isAnimationActive={false}
          data={withRate.filter((r) => r.classification !== "A")}
          fill="var(--ref)"
          stroke="var(--surface)"
          strokeWidth={2}
          cursor="pointer"
          onClick={open}
        />
        <Scatter
          isAnimationActive={false}
          data={withRate.filter((r) => r.classification === "A")}
          fill="var(--accent)"
          stroke="var(--surface)"
          strokeWidth={2}
          cursor="pointer"
          onClick={open}
        />
      </ScatterChart>
    </ResponsiveContainer>
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

// 시간대별 평균 속도 막대
export function TimebandBars({ data, height = 240 }: { data: { label: string; avg_spd: number; link_cnt?: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 24, bottom: 0, left: 4 }} barCategoryGap={4}>
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
                  ...(payload[0].payload.link_cnt != null
                    ? [["관측 링크", `${payload[0].payload.link_cnt}개`] as [string, string]]
                    : []),
                ]}
              />
            ) : null
          }
        />
        <Bar isAnimationActive={false} dataKey="avg_spd" fill="var(--accent)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// 저속 비중 막대 (도로 여건 색, 기준선 13·22%)
export function LowSpeedBars({ regions, fastMax, slowMin, height = 320 }: { regions: Region[]; fastMax: number; slowMin: number; height?: number }) {
  const data = [...regions].sort((a, b) => b.low_spd_ratio - a.low_spd_ratio).map((r) => ({ ...r, name: r.adm_nm }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 4 }} barCategoryGap={3}>
        <CartesianGrid stroke="var(--grid)" horizontal={false} />
        <XAxis type="number" {...axisProps} unit="%" />
        <YAxis type="category" dataKey="name" {...axisProps} width={72} interval={0} />
        <ReferenceLine x={fastMax} stroke="var(--muted)" strokeDasharray="4 4" />
        <ReferenceLine x={slowMin} stroke="var(--muted)" strokeDasharray="4 4" />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <Tip
                style={chartTipStyle}
                title={`${payload[0].payload.sgg_nm} ${payload[0].payload.adm_nm}`}
                rows={[
                  ["저속 비중", fmtPct(Number(payload[0].value))],
                  ["평균 속도", `${payload[0].payload.avg_spd} km/h`],
                ]}
              />
            ) : null
          }
        />
        <Bar
          isAnimationActive={false}
          dataKey="low_spd_ratio"
          radius={[0, 4, 4, 0]}
          cursor="pointer"
          onClick={(d: { adm_cd?: string }) => d.adm_cd && navigate(`/regions/${d.adm_cd}`)}
        >
          {data.map((r) => (
            <Cell key={r.adm_cd} fill={r.charger_hint ? `var(--hint-${r.charger_hint})` : "var(--ref)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
