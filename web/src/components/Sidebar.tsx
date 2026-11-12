// 왼쪽 사이드바: 전체 메뉴 (접으면 아이콘 레일, 모바일은 서랍)
import { hasRole, type Role } from "../auth/roles";
import { activeItem, visibleGroups } from "../nav";
import { Link } from "../router";
import { Icon } from "./Icon";

const REPO_URL = "https://github.com/CoderGogh/seoul-ev-data-platform";

interface SidebarProps {
  path: string;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
  role?: Role | null;
}

export function Brand() {
  return (
    <Link to="/" className="brand" title="서울 전동화 입지 인사이트">
      <span className="brand-mark" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
        </svg>
      </span>
      <span className="brand-text">
        서울 전동화 입지
        <small>EV Insight Console</small>
      </span>
    </Link>
  );
}

export function Sidebar({ path, open, collapsed, onClose, onToggleCollapsed, role }: SidebarProps) {
  const current = activeItem(path);
  const cls = ["sidebar", open && "open", collapsed && "collapsed"].filter(Boolean).join(" ");

  return (
    <>
      <aside className={cls} data-bs-theme="dark" aria-label="메뉴">
        <div className="side-head">
          <Brand />
          <button className="btn btn-link side-close" onClick={onClose} aria-label="메뉴 닫기">
            <Icon name="close" />
          </button>
        </div>

        <nav className="side-nav">
          {visibleGroups(role).map((g) => (
            <div key={g.title} className="side-group">
              <div className="side-title">{g.title}</div>
              <ul className="nav nav-pills flex-column">
                {g.items.map((item) => {
                  const locked = !hasRole(role, item.minRole);
                  return (
                    <li key={item.to} className="nav-item">
                      <Link
                        to={item.to}
                        className={`nav-link side-link${current?.to === item.to ? " active" : ""}`}
                        title={collapsed ? item.label : item.desc}
                        aria-current={current?.to === item.to ? "page" : undefined}
                      >
                        <Icon name={item.icon} />
                        <span className="side-label">{item.label}</span>
                        {locked && (
                          <span className="side-lock" title="운영 권한 필요">
                            <Icon name="lock" size={13} />
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="side-foot">
          <a className="btn btn-link side-tool" href={REPO_URL} title="GitHub 저장소" aria-label="GitHub 저장소">
            <Icon name="github" />
          </a>
          <button
            className="btn btn-link side-tool side-collapse"
            onClick={onToggleCollapsed}
            title={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
            aria-label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
          >
            <Icon name={collapsed ? "expand" : "collapse"} />
          </button>
        </div>
      </aside>
      {open && <div className="side-backdrop" onClick={onClose} aria-hidden="true" />}
    </>
  );
}
