// 페이지 머리글 (태그·제목·설명·우측 동작)
import type { ReactNode } from "react";

interface PageHeadProps {
  tags?: string[];
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function PageHead({ tags, title, lede, actions, children }: PageHeadProps) {
  return (
    <section className="page-head">
      <div className="page-head-row">
        <div className="page-head-main">
          {tags && tags.length > 0 && (
            <div className="page-tags">
              {tags.map((t) => (
                <span key={t} className="page-tag">
                  {t}
                </span>
              ))}
            </div>
          )}
          <h1>{title}</h1>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </section>
  );
}

// 카드 머리글 (제목·부제·우측 동작)
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
