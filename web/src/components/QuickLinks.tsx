// 첫 화면 바로가기: 카테고리별 화면 버튼
import type { Role } from "../auth/roles";
import { hasRole } from "../auth/roles";
import { visibleGroups } from "../nav";
import { Link } from "../router";
import { Icon } from "./Icon";

export function QuickLinks({ role }: { role?: Role | null }) {
  const groups = visibleGroups(role).filter((g) => g.title !== "개요");
  return (
    <section id="dash-quick" className="quick" aria-label="화면 바로가기">
      {groups.map((g) => (
        <div key={g.title} className="quick-group">
          <div className="quick-title">{g.title}</div>
          <div className="quick-grid">
            {g.items.map((i) => (
              <Link key={i.to} to={i.to} className="quick-tile" title={i.desc}>
                <span className={`tile-icon tile-lg tone-${g.tone}`}>
                  <Icon name={i.icon} size={24} />
                  {!hasRole(role, i.minRole) && (
                    <span className="tile-lock">
                      <Icon name="lock" size={11} />
                    </span>
                  )}
                </span>
                <b>{i.label}</b>
                <small>{i.desc}</small>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
