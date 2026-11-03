// 상단 바: 로고·카테고리 메뉴(드롭다운)·기준일·테마·사용자, 상세 화면은 카테고리 탭 줄
import type { ReactNode } from "react";
import type { Role } from "../auth/roles";
import { hasRole } from "../auth/roles";
import { groupOf, visibleGroups, type NavItem } from "../nav";
import { Link } from "../router";
import type { Theme } from "../theme";
import { Icon } from "./Icon";

interface HeaderProps {
  current?: NavItem;
  isHome: boolean;
  role?: Role | null;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenMenu: () => void;
  right?: ReactNode;
}

export function Brand() {
  return (
    <Link to="/" className="brand" title="서울 전동화 입지 인사이트">
      <span className="brand-mark" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
        </svg>
      </span>
      <span className="brand-text">서울 전동화 입지 인사이트</span>
    </Link>
  );
}

export function Header({ current, isHome, role, theme, onToggleTheme, onOpenMenu, right }: HeaderProps) {
  const groups = visibleGroups(role);
  const group = groupOf(current);
  const tabs = !isHome && group ? groups.find((g) => g.title === group.title)?.items ?? [] : [];

  return (
    <div className="header-wrap">
      <header className="gnb">
        <div className="gnb-inner">
          <button className="icon-btn gnb-menu" onClick={onOpenMenu} aria-label="메뉴 열기">
            <Icon name="menu" size={22} />
          </button>
          <Brand />

          <nav className="gnb-nav" aria-label="카테고리">
            {groups.map((g) => (
              <div key={g.title} className="gnb-item">
                <Link
                  to={g.items[0].to}
                  className="gnb-link"
                  aria-current={group?.title === g.title ? "page" : undefined}
                >
                  {g.title}
                  {g.items.length > 1 && <Icon name="chevron" size={12} />}
                </Link>
                {g.items.length > 1 && (
                  <div className="gnb-drop" role="menu">
                    {g.items.map((i) => (
                      <Link key={i.to} to={i.to} className="gnb-drop-link">
                        <span className={`tile-icon tone-${g.tone}`}>
                          <Icon name={i.icon} size={16} />
                        </span>
                        <span>
                          <b>
                            {i.label}
                            {!hasRole(role, i.minRole) && <Icon name="lock" size={12} />}
                          </b>
                          <small>{i.desc}</small>
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>

          <div className="gnb-tools">
            <button
              className="icon-btn"
              onClick={onToggleTheme}
              title={theme === "light" ? "다크 모드" : "라이트 모드"}
              aria-label={theme === "light" ? "다크 모드" : "라이트 모드"}
            >
              <Icon name={theme === "light" ? "moon" : "sun"} size={20} />
            </button>
            {right}
          </div>
        </div>
      </header>

      {tabs.length > 0 && group && (
        <nav className="subtabs" aria-label={`${group.title} 화면`}>
          <div className="subtabs-inner">
            <span className="subtabs-title">{group.title}</span>
            {tabs.map((t) => (
              <Link key={t.to} to={t.to} className="subtab" aria-current={current?.to === t.to ? "page" : undefined}>
                {t.label}
                {!hasRole(role, t.minRole) && <Icon name="lock" size={12} />}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
