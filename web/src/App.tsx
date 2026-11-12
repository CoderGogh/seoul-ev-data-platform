// 레이아웃 (사이드바 + 본문)·경로 분기
import { useEffect, useState } from "react";
import { loadData, type AppData } from "./data";
import { LOGIN_ITEM, activeItem } from "./nav";
import { useAuth } from "./auth/AuthContext";
import { Link, usePath } from "./router";
import { useTheme } from "./theme";
import { useCollapsed } from "./sidebar";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { Aside } from "./components/Aside";
import { FreshnessAlert } from "./components/Freshness";
import { RequireRole } from "./components/RequireRole";
import { UserMenu } from "./components/UserMenu";
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
import { Supply } from "./pages/Supply";
import { ProgressPage } from "./pages/Progress";
import { Versions } from "./pages/Versions";
import { Compare } from "./pages/Compare";
import { History } from "./pages/History";
import { VersionStamp } from "./components/VersionStamp";
import { stampFor } from "./versions";
import { hasRole } from "./auth/roles";
import { Login } from "./pages/Login";
import { AdminUsers } from "./pages/AdminUsers";

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
  "/supply": Supply,
  "/progress": ProgressPage,
  "/versions": Versions,
  "/compare": Compare,
  "/history": History,
};

// 데이터 없이 여는 화면 (로그인·관리)
const STANDALONE: Record<string, () => JSX.Element | null> = {
  "/login": Login,
  "/admin/users": AdminUsers,
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
  const { collapsed, toggle: toggleCollapsed } = useCollapsed();
  const current = activeItem(path) ?? (path === "/login" ? LOGIN_ITEM : undefined);
  const { profile } = useAuth();
  const Standalone = STANDALONE[path];

  useEffect(() => {
    loadData().then(setData, (e: Error) => setError(e.message));
  }, []);

  // 이동 시 모바일 메뉴 닫기·탭 제목
  useEffect(() => {
    setMenuOpen(false);
    document.title = current && path !== "/" ? `${current.label} · ${SITE}` : SITE;
  }, [path, current]);

  const isHome = path === "/";

  return (
    <div className="app">
      <Header
        current={current}
        role={profile?.role}
        theme={theme}
        onToggleTheme={toggle}
        onOpenMenu={() => setMenuOpen(true)}
        right={<UserMenu />}
      />
      <div className={`frame${collapsed ? " rail" : ""}${isHome ? " home" : ""}`}>
        <Sidebar
          path={path}
          open={menuOpen}
          collapsed={collapsed}
          onClose={() => setMenuOpen(false)}
          onToggleCollapsed={toggleCollapsed}
          role={profile?.role}
        />
        <main className="main">
          {Standalone ? (
            <RequireRole min={current?.minRole} path={path}>
              <Standalone />
            </RequireRole>
          ) : (
            <>
              {error && <div className="alert alert-danger">데이터를 불러오지 못했습니다. {error}</div>}
              {!error && !data && (
                <div className="empty">
                  <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                  불러오는 중…
                </div>
              )}
              {data && hasRole(profile?.role, "operator") && <FreshnessAlert data={data} />}
              {data && (
                <RequireRole min={current?.minRole} path={path}>
                  {route(path, data)}
                  <VersionStamp items={stampFor(path, data)} />
                </RequireRole>
              )}
            </>
          )}
        </main>
        <Aside data={data} current={current} isHome={isHome} />
      </div>
      <footer className="footer">
        <div className="footer-inner">
          <span>데이터: 서울 열린데이터광장 실시간 도로소통정보 · 자동차 등록현황 · 한국환경공단 전기자동차 충전소 정보</span>
        </div>
      </footer>
    </div>
  );
}
