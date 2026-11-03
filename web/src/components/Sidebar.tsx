// 왼쪽 바: 카테고리별 메뉴·접기(아이콘 레일), 모바일은 서랍
import { hasRole, type Role } from "../auth/roles";
import { activeItem, visibleGroups } from "../nav";
import { Link } from "../router";
import { Brand } from "./Header";
import { Icon } from "./Icon";

const REPO_URL = "https://github.com/CoderGogh/seoul-ev-data-platform";

interface SidebarProps {
  path: string;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
  baseMonth?: string;
  role?: Role | null;
}

export function Sidebar({ path, open, collapsed, onClose, onToggleCollapsed, baseMonth, role }: SidebarProps) {
  const current = activeItem(path);
  const cls = ["sidebar", open && "open", collapsed && "collapsed"].filter(Boolean).join(" ");
  return (
    <>
      <aside className={cls} aria-label="카테고리 메뉴">
        <div className="side-head">
          <Brand />
          <button className="icon-btn side-close" onClick={onClose} aria-label="메뉴 닫기">
            <Icon name="close" />
          </button>
        </div>

        <nav className="side-nav">
          {visibleGroups(role).map((g) => (
            <div key={g.title} className="side-group">
              <div className="side-group-title">{g.title}</div>
              {g.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="side-link"
                  title={collapsed ? item.label : item.desc}
                  aria-current={current?.to === item.to ? "page" : undefined}
                >
                  <Icon name={item.icon} />
                  <span className="side-label">{item.label}</span>
                  {!hasRole(role, item.minRole) && (
                    <span className="side-lock" title="운영 권한 필요">
                      <Icon name="lock" size={14} />
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          {baseMonth && (
            <div className="side-meta">
              등록 기준월 <b>{`${baseMonth.slice(0, 4)}.${baseMonth.slice(4)}`}</b>
            </div>
          )}
          <div className="side-tools">
            <a className="icon-btn" href={REPO_URL} title="GitHub 저장소" aria-label="GitHub 저장소">
              <Icon name="github" />
            </a>
            <button
              className="icon-btn side-collapse"
              onClick={onToggleCollapsed}
              title={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
              aria-label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
            >
              <Icon name={collapsed ? "expand" : "collapse"} />
            </button>
          </div>
        </div>
      </aside>
      {open && <div className="backdrop" onClick={onClose} aria-hidden="true" />}
    </>
  );
}
