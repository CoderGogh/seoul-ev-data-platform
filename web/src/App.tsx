// 레이아웃 (사이드바 + 본문)·경로 분기
import { useEffect, useState } from "react";
import { loadData, type AppData } from "./data";
import { activeItem } from "./nav";
import { Link, usePath } from "./router";
import { useTheme } from "./theme";
import { Icon } from "./components/Icon";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { Priority } from "./pages/Priority";
import { MapPage } from "./pages/MapPage";
import { Regions } from "./pages/Regions";
import { RegionDetail } from "./pages/RegionDetail";
import { Criteria } from "./pages/Criteria";
import { Trend } from "./pages/Trend";
import { Road } from "./pages/Road";
import { Quality } from "./pages/Quality";
import { Pipeline } from "./pages/Pipeline";

const SITE = "서울 전동화 입지 인사이트";

const PAGES: Record<string, (props: { data: AppData }) => JSX.Element> = {
  "/": Dashboard,
  "/priority": Priority,
  "/map": MapPage,
  "/regions": Regions,
  "/criteria": Criteria,
  "/trend": Trend,
  "/road": Road,
  "/quality": Quality,
  "/pipeline": Pipeline,
};

function route(path: string, data: AppData) {
  const Page = PAGES[path];
  if (Page) return <Page data={data} />;
  const m = path.match(/^\/regions\/(\d{10})$/);
  if (m) return <RegionDetail key={m[1]} data={data} admCd={m[1]} />;
  return (
    <div className="empty">
      없는 페이지입니다. <Link to="/">대시보드로</Link>
    </div>
  );
}

export function App() {
  const path = usePath();
  const { theme, toggle } = useTheme();
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const current = activeItem(path);

  useEffect(() => {
    loadData().then(setData, (e: Error) => setError(e.message));
  }, []);

  // 이동 시 모바일 메뉴 닫기·탭 제목
  useEffect(() => {
    setMenuOpen(false);
    document.title = current && path !== "/" ? `${current.label} · ${SITE}` : SITE;
  }, [path, current]);

  return (
    <div className="shell">
      <Sidebar
        path={path}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        theme={theme}
        onToggleTheme={toggle}
        baseMonth={data?.meta.base_month}
      />
      <div className="content">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="메뉴 열기">
            <Icon name="menu" />
          </button>
          <span className="topbar-title">{current?.label ?? "검토 카드"}</span>
        </header>
        <main className="main">
          {error && <div className="empty">데이터를 불러오지 못했습니다. {error}</div>}
          {!error && !data && <div className="empty">불러오는 중…</div>}
          {data && route(path, data)}
        </main>
        <footer className="footer">
          <span>데이터: 서울 열린데이터광장 실시간 도로소통정보 · 자동차 등록현황</span>
          <span>2026-10-28 게시 결과 스냅샷</span>
        </footer>
      </div>
    </div>
  );
}
