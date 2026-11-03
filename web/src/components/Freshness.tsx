// 데이터 기준일: 상단 바 칩(펼치면 원천별 상세)·오래되면 본문 경고 띠
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppData } from "../data";
import { freshness, summary, worst } from "../freshness";

const LEVEL_TEXT = { ok: "정상", warn: "주의", bad: "오래됨" } as const;

function useFresh(data: AppData) {
  const items = useMemo(() => freshness(data.meta, data.chargers), [data]);
  return { items, level: worst(items), msg: summary(items) };
}

export function FreshnessChip({ data }: { data: AppData }) {
  const { items, level } = useFresh(data);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 바깥 클릭·Esc 시 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const publish = items.find((i) => i.key === "publish");
  return (
    <div className="pop" ref={ref}>
      <button
        className={`fresh-chip tone-${level}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`데이터 기준일 ${LEVEL_TEXT[level]}`}
      >
        <span className="dot" aria-hidden="true" />
        <span className="fresh-chip-text">
          기준일 {publish ? publish.value : ""} · {LEVEL_TEXT[level]}
        </span>
      </button>
      {open && (
        <div className="pop-panel" role="dialog" aria-label="데이터 기준일">
          <div className="pop-title">원천별 기준일</div>
          <ul className="fresh-list">
            {items.map((i) => (
              <li key={i.key}>
                <span className={`dot tone-${i.level}`} aria-hidden="true" />
                <b>{i.label}</b>
                <span>{i.value}</span>
                <span className="fresh-age">{i.age}</span>
                <small>{i.rule}</small>
              </li>
            ))}
          </ul>
          <div className="pop-foot" title={data.source.reason ?? data.source.sha}>
            {data.source.kind === "remote" ? `자동 갱신 데이터 ${data.source.sha?.slice(0, 7)}` : "배포 스냅샷 데이터"}
          </div>
        </div>
      )}
    </div>
  );
}

// 주의·오래됨일 때만 본문 상단 경고
export function FreshnessAlert({ data }: { data: AppData }) {
  const { level, msg } = useFresh(data);
  if (level === "ok" || !msg) return null;
  return (
    <p className={`fresh-alert fresh-${level}`} role="status">
      {msg}
    </p>
  );
}
