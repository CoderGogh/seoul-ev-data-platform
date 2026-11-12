// 첫 화면 바로가기: 카테고리별 카드 + 화면 버튼
import type { Role } from "../auth/roles";
import { hasRole } from "../auth/roles";
import { visibleGroups } from "../nav";
import { Link } from "../router";
import { CardHead } from "./PageHead";
import { Icon } from "./Icon";

export function QuickLinks({ role }: { role?: Role | null }) {
  const groups = visibleGroups(role).filter((g) => g.title !== "개요");
  return (
    <div className="quick" aria-label="화면 바로가기">
      {groups.map((g) => (
        <section key={g.title} className={`card card-body quick-group tone-${g.tone}`}>
          <CardHead title={g.title} sub={`화면 ${g.items.length}개`} />
          <div className="quick-grid">
            {g.items.map((i) => {
              const locked = !hasRole(role, i.minRole);
              return (
                <Link key={i.to} to={i.to} className="quick-tile" title={i.desc}>
                  <span className="tile-icon tile-lg">
                    <Icon name={i.icon} size={22} />
                    {locked && (
                      <span className="tile-lock">
                        <Icon name="lock" size={11} />
                      </span>
                    )}
                  </span>
                  <span className="quick-text">
                    <b>{i.label}</b>
                    <small>{i.desc}</small>
                  </span>
                  <span className="quick-go" aria-hidden="true">
                    <Icon name="chevron" size={16} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
