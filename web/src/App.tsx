// 레이아웃 (사이드바 + 본문)·경로 분기
import { useEffect, useState } from "react";
import { loadData, type AppData } from "./data";
import { LOGIN_ITEM, activeItem } from "./nav";
import { useAuth } from "./auth/AuthContext";
import { Link, usePath } from "./router";
import { useTheme } from "./theme";
import { useCollapsed } from "./sidebar";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
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

  return (
    <div className={`shell${collapsed ? " rail" : ""}`}>
      <Sidebar
        path={path}
        open={menuOpen}
        collapsed={collapsed}
        onClose={() => setMenuOpen(false)}
        onToggleCollapsed={toggleCollapsed}
        baseMonth={data?.meta.base_month}
        role={profile?.role}
      />
      <div className="content">
        <Topbar
          current={current}
          fallbackTitle="검토 카드"
          data={data}
          theme={theme}
          onToggleTheme={toggle}
          onOpenMenu={() => setMenuOpen(true)}
          right={<UserMenu />}
        />
        <main className="main">
          {Standalone ? (
            <RequireRole min={current?.minRole} path={path}>
              <Standalone />
            </RequireRole>
          ) : (
            <>
              {error && <div className="empty">데이터를 불러오지 못했습니다. {error}</div>}
              {!error && !data && <div className="empty">불러오는 중…</div>}
              {data && <FreshnessAlert data={data} />}
              {data && (
                <RequireRole min={current?.minRole} path={path}>
                  {route(path, data)}
                </RequireRole>
              )}
            </>
          )}
        </main>
        <footer className="footer">
          <span>데이터: 서울 열린데이터광장 실시간 도로소통정보 · 자동차 등록현황 · 한국환경공단 전기자동차 충전소 정보</span>
          <span>{data ? `${data.meta.threshold.ver} 게시 결과 스냅샷` : "게시 결과 스냅샷"}</span>
        </footer>
      </div>
    </div>
  );
}
