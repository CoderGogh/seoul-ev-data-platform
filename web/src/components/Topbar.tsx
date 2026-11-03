// 상단 바: 메뉴 버튼(모바일)·경로·기준일 칩·테마·우측 슬롯
import type { ReactNode } from "react";
import type { AppData } from "../data";
import { groupOf, type NavItem } from "../nav";
import type { Theme } from "../theme";
import { FreshnessChip } from "./Freshness";
import { Icon } from "./Icon";

interface TopbarProps {
  current?: NavItem;
  fallbackTitle: string;
  data: AppData | null;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenMenu: () => void;
  right?: ReactNode;
}

export function Topbar({ current, fallbackTitle, data, theme, onToggleTheme, onOpenMenu, right }: TopbarProps) {
  const group = groupOf(current);
  return (
    <header className="topbar">
      <button className="icon-btn topbar-menu" onClick={onOpenMenu} aria-label="메뉴 열기">
        <Icon name="menu" />
      </button>
      <div className="crumb">
        {group && (
          <>
            <span className="crumb-group">{group.title}</span>
            <Icon name="chevron" size={14} />
          </>
        )}
        <span className="crumb-title">{current?.label ?? fallbackTitle}</span>
      </div>
      <div className="topbar-right">
        {data && <FreshnessChip data={data} />}
        <button
          className="icon-btn"
          onClick={onToggleTheme}
          title={theme === "light" ? "다크 모드" : "라이트 모드"}
          aria-label={theme === "light" ? "다크 모드" : "라이트 모드"}
        >
          <Icon name={theme === "light" ? "moon" : "sun"} />
        </button>
        {right}
      </div>
    </header>
  );
}
