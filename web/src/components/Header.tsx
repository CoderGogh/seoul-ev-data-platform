// 상단 바: 메뉴 버튼·현재 위치·데이터 상태·테마·사용자
import { useMemo, type ReactNode } from "react";
import type { Role } from "../auth/roles";
import { hasRole } from "../auth/roles";
import type { AppData } from "../data";
import { freshness, worst } from "../freshness";
import { groupOf, type NavItem } from "../nav";
import { Link } from "../router";
import type { Theme } from "../theme";
import { Icon } from "./Icon";

interface HeaderProps {
  current?: NavItem;
  data: AppData | null;
  role?: Role | null;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenMenu: () => void;
  right?: ReactNode;
}

const LEVEL = {
  ok: { text: "데이터 정상", cls: "text-bg-success" },
  warn: { text: "데이터 주의", cls: "text-bg-warning" },
  bad: { text: "데이터 오래됨", cls: "text-bg-danger" },
} as const;

// 데이터 신선도 (운영 이상, 누르면 데이터 버전)
function FreshPill({ data }: { data: AppData }) {
  const level = useMemo(() => worst(freshness(data.meta, data.chargers)), [data]);
  const l = LEVEL[level];
  return (
    <Link to="/versions" className={`badge rounded-pill fresh-pill ${l.cls}`} title="원천별 기준일 보기">
      {l.text}
    </Link>
  );
}

export function Header({ current, data, role, theme, onToggleTheme, onOpenMenu, right }: HeaderProps) {
  const group = groupOf(current);
  const isHome = current?.to === "/";

  return (
    <header className="topbar">
      <button className="btn btn-link topbar-menu" onClick={onOpenMenu} aria-label="메뉴 열기">
        <Icon name="menu" size={22} />
      </button>

      <nav aria-label="현재 위치" className="topbar-crumb">
        <ol className="breadcrumb mb-0">
          {!isHome && (
            <li className="breadcrumb-item">
              <Link to="/">홈</Link>
            </li>
          )}
          {group && !isHome && <li className="breadcrumb-item">{group.title}</li>}
          <li className="breadcrumb-item active" aria-current="page">
            {current?.label ?? "대시보드"}
          </li>
        </ol>
      </nav>

      <div className="topbar-tools">
        {data && hasRole(role, "operator") && <FreshPill data={data} />}
        <button
          className="btn btn-link topbar-icon"
          onClick={onToggleTheme}
          title={theme === "light" ? "다크 모드" : "라이트 모드"}
          aria-label={theme === "light" ? "다크 모드" : "라이트 모드"}
        >
          <Icon name={theme === "light" ? "moon" : "sun"} size={19} />
        </button>
        {right}
      </div>
    </header>
  );
}
