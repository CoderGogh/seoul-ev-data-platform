// 분류·도로 여건 배지 (색 + 문구)
import { CLASS_LABEL, HINT_LABEL, type ChargerHint, type Classification } from "../data";

export function ClassBadge({ value }: { value: Classification }) {
  return <span className={`badge${value === "A" ? " badge-a" : ""}`}>{CLASS_LABEL[value]}</span>;
}

export function HintBadge({ value, prefix = false }: { value: ChargerHint | null; prefix?: boolean }) {
  if (!value) return <span className="badge">도로 여건 미산출</span>;
  return (
    <span className={`badge badge-hint badge-hint-${value}`}>
      {prefix ? "도로 " : ""}
      {HINT_LABEL[value]}
    </span>
  );
}
