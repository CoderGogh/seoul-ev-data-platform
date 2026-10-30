// 사이드바: 카테고리별 메뉴·테마 전환·데이터 기준
import { NAV_GROUPS, activeItem } from "../nav";
import { Link } from "../router";
import type { Theme } from "../theme";
import { Icon } from "./Icon";

const REPO_URL = "https://github.com/CoderGogh/seoul-ev-data-platform";

interface SidebarProps {
  path: string;
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  baseMonth?: string;
}

export function Sidebar({ path, open, onClose, theme, onToggleTheme, baseMonth }: SidebarProps) {
  const current = activeItem(path);
  return (
    <>
      <aside className={`sidebar${open ? " open" : ""}`} aria-label="사이드 메뉴">
        <div className="side-head">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
              </svg>
            </span>
            <span>
              서울 전동화
              <br />
              입지 인사이트
            </span>
          </Link>
          <button className="icon-btn side-close" onClick={onClose} aria-label="메뉴 닫기">
            <Icon name="close" />
          </button>
        </div>

        <nav className="side-nav">
          {NAV_GROUPS.map((g) => (
            <div key={g.title} className="side-group">
              <div className="side-group-title">{g.title}</div>
              {g.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="side-link"
                  aria-current={current?.to === item.to ? "page" : undefined}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
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
          <div className="side-actions">
            <button className="side-btn" onClick={onToggleTheme}>
              <Icon name={theme === "light" ? "moon" : "sun"} size={16} />
              {theme === "light" ? "다크 모드" : "라이트 모드"}
            </button>
            <a className="side-btn" href={REPO_URL}>
              <Icon name="github" size={16} />
              GitHub
            </a>
          </div>
        </div>
      </aside>
      {open && <div className="backdrop" onClick={onClose} aria-hidden="true" />}
    </>
  );
}
