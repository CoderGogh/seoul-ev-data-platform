// 지도·차트 공용 툴팁 본문
import type { CSSProperties } from "react";

interface TipProps {
  title: string;
  rows: [string, string][];
  style?: CSSProperties;
}

export function Tip({ title, rows, style }: TipProps) {
  return (
    <div className="tip" style={style}>
      <div className="tip-title">{title}</div>
      {rows.map(([k, v]) => (
        <div className="tip-row" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

// recharts 툴팁 래퍼 (위치는 recharts 가 지정)
export const chartTipStyle: CSSProperties = { position: "static" };
