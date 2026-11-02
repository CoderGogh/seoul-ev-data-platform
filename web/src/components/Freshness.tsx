// 모든 페이지 상단 기준일 띠: 원천별 기준일·경과 배지, 오래되면 경고 색
import { useMemo, useState } from "react";
import type { AppData } from "../data";
import { freshness, summary, worst } from "../freshness";

const LEVEL_TEXT = { ok: "정상", warn: "주의", bad: "오래됨" } as const;

export function FreshnessBar({ data }: { data: AppData }) {
  const items = useMemo(() => freshness(data.meta, data.chargers), [data]);
  const level = worst(items);
  const msg = summary(items);
  const [open, setOpen] = useState(false);

  return (
    <section className={`fresh fresh-${level}`} aria-label="데이터 기준일">
      <div className="fresh-row">
        <span className="fresh-title">기준일</span>
        {items.map((i) => (
          <span key={i.key} className={`fresh-item tone-${i.level}`} title={i.rule}>
            <b>{i.label}</b> {i.value} <span className="fresh-age">{i.age}</span>
          </span>
        ))}
        <button className="fresh-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "닫기" : "기준"}
        </button>
      </div>
      {msg && <p className="fresh-msg">{msg}</p>}
      {open && (
        <ul className="fresh-rules">
          {items.map((i) => (
            <li key={i.key}>
              <b>{i.label}</b> {LEVEL_TEXT[i.level]} · {i.rule}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
