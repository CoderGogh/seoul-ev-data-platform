// 상단 바: 로고·큰 카테고리(마우스 올리면 하위 화면 패널이 내려옴)·테마·사용자
import type { ReactNode } from "react";
import type { Role } from "../auth/roles";
import { hasRole } from "../auth/roles";
import { groupOf, visibleGroups, type NavItem } from "../nav";
import { Link } from "../router";
import type { Theme } from "../theme";
import { Icon } from "./Icon";

interface HeaderProps {
  current?: NavItem;
  role?: Role | null;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenMenu: () => void;
  right?: ReactNode;
}

const ROW_H = 40; // 하위 화면 한 줄 높이

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

export function Header({ current, role, theme, onToggleTheme, onOpenMenu, right }: HeaderProps) {
  const groups = visibleGroups(role);
  const group = groupOf(current);
  const rows = Math.max(...groups.map((g) => g.items.length));

  return (
    <header className="gnb">
      <div className="gnb-inner">
        <button className="icon-btn gnb-menu" onClick={onOpenMenu} aria-label="메뉴 열기">
          <Icon name="menu" size={22} />
        </button>
        <Brand />

        <nav className="gnb-nav" aria-label="카테고리" style={{ ["--mega-h" as string]: `${rows * ROW_H + 28}px` }}>
          {groups.map((g) => (
            <div key={g.title} className="gnb-item">
              <Link to={g.items[0].to} className="gnb-link" aria-current={group?.title === g.title ? "page" : undefined}>
                {g.title}
              </Link>
              <div className="gnb-drop">
                {g.items.map((i) => (
                  <Link
                    key={i.to}
                    to={i.to}
                    className="gnb-drop-link"
                    title={i.desc}
                    aria-current={current?.to === i.to ? "page" : undefined}
                  >
                    {i.label}
                    {!hasRole(role, i.minRole) && <Icon name="lock" size={12} />}
                  </Link>
                ))}
              </div>
            </div>
          ))}
          <div className="mega-bg" aria-hidden="true" />
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
  );
}
