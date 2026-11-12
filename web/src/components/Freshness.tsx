// 데이터 기준일 경고 띠 (주의·오래됨일 때, 운영 이상에게만)
import { useMemo } from "react";
import type { AppData } from "../data";
import { freshness, summary, worst } from "../freshness";

export function FreshnessAlert({ data }: { data: AppData }) {
  const items = useMemo(() => freshness(data.meta, data.chargers), [data]);
  const level = worst(items);
  const msg = summary(items);
  if (level === "ok" || !msg) return null;
  return (
    <p className={`alert alert-${level === "bad" ? "danger" : "warning"} py-2`} role="status">
      {msg}
    </p>
  );
}
