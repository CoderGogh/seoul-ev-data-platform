// 페이지 머리글 (태그·제목·설명)
import type { ReactNode } from "react";

interface PageHeadProps {
  tags?: string[];
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
}

export function PageHead({ tags, title, lede, children }: PageHeadProps) {
  return (
    <section className="hero">
      {tags && tags.length > 0 && (
        <div className="kicker">
          {tags.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
      )}
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </section>
  );
}

// 카드 제목 + 상세 페이지 링크
export function CardHead({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card-head">
      <div>
        <h2>{title}</h2>
        {sub && <p className="card-sub">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
