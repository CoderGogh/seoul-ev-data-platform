// 왼쪽 바: 현재 카테고리의 하위 화면만 (첫 화면은 구역 바로가기), 모바일 서랍은 전체 카테고리
import { hasRole, type Role } from "../auth/roles";
import { HOME_SECTIONS, activeItem, groupOf, visibleGroups } from "../nav";
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
  role?: Role | null;
}

// 구역으로 스크롤
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function Sidebar({ path, open, collapsed, onClose, onToggleCollapsed, role }: SidebarProps) {
  const current = activeItem(path);
  const group = groupOf(current);
  const isHome = path === "/";
  const showAll = !isHome && !group; // 로그인 등 분류 없는 화면
  const cls = ["sidebar", open && "open", collapsed && "collapsed"].filter(Boolean).join(" ");

  return (
    <>
      <aside className={cls} aria-label={group ? `${group.title} 메뉴` : "메뉴"}>
        <div className="side-head">
          <Brand />
          <button className="icon-btn side-close" onClick={onClose} aria-label="메뉴 닫기">
            <Icon name="close" />
          </button>
        </div>

        {isHome && (
          <div className="side-group side-current side-home">
            <div className="side-title">개요</div>
            {HOME_SECTIONS.map((s) => (
              <button key={s.id} className="side-link" title={s.label} onClick={() => jump(s.id)}>
                <Icon name={s.icon} />
                <span className="side-label">{s.label}</span>
              </button>
            ))}
          </div>
        )}

        <nav className="side-nav">
          {visibleGroups(role).map((g) => (
            <div key={g.title} className={`side-group${showAll || (!isHome && g.title === group?.title) ? " side-current" : " side-other"}`}>
              <div className="side-title">{g.title}</div>
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
