// 화면 하단 버전 표시 (필요한 기준 시점만 작게)
export function VersionStamp({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <p className="ver-stamp" aria-label="데이터 기준">
      <span className="ver-tag">v</span>
      {items.join(" · ")}
    </p>
  );
}
