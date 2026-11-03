// 사이드바: 카테고리별 메뉴·접기(아이콘 레일)·하단 슬롯
import type { ReactNode } from "react";
import { NAV_GROUPS, activeItem } from "../nav";
import { Link } from "../router";
import { Icon } from "./Icon";

const REPO_URL = "https://github.com/CoderGogh/seoul-ev-data-platform";

interface SidebarProps {
  path: string;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
  baseMonth?: string;
  footer?: ReactNode;
}

export function Sidebar({ path, open, collapsed, onClose, onToggleCollapsed, baseMonth, footer }: SidebarProps) {
  const current = activeItem(path);
  const cls = ["sidebar", open && "open", collapsed && "collapsed"].filter(Boolean).join(" ");
  return (
    <>
      <aside className={cls} aria-label="사이드 메뉴">
        <div className="side-head">
          <Link to="/" className="brand" title="서울 전동화 입지 인사이트">
            <span className="brand-mark" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
              </svg>
            </span>
            <span className="brand-text">
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
                  title={collapsed ? item.label : item.desc}
                  aria-current={current?.to === item.to ? "page" : undefined}
                >
                  <Icon name={item.icon} />
                  <span className="side-label">{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          {footer}
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
