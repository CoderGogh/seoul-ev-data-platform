// 레이아웃·경로 분기
import { useEffect, useState } from "react";
import { fmtDateTime, fmtMonth, loadData, type AppData } from "./data";
import { Link, usePath } from "./router";
import { useTheme } from "./theme";
import { Overview } from "./pages/Overview";
import { Regions } from "./pages/Regions";
import { RegionDetail } from "./pages/RegionDetail";
import { Quality } from "./pages/Quality";

const NAV = [
  { to: "/", label: "개요" },
  { to: "/regions", label: "지도·목록" },
  { to: "/quality", label: "데이터 품질" },
];

const REPO_URL = "https://github.com/CoderGogh/seoul-ev-data-platform";

function route(path: string, data: AppData) {
  if (path === "/") return <Overview data={data} />;
  if (path === "/regions") return <Regions data={data} />;
  if (path === "/quality") return <Quality data={data} />;
  const m = path.match(/^\/regions\/(\d{10})$/);
  if (m) return <RegionDetail key={m[1]} data={data} admCd={m[1]} />;
  return (
    <div className="empty">
      없는 페이지입니다. <Link to="/">개요로</Link>
    </div>
  );
}

export function App() {
  const path = usePath();
  const { theme, toggle } = useTheme();
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData().then(setData, (e: Error) => setError(e.message));
  }, []);

  const section = path.startsWith("/regions") ? "/regions" : path;

  return (
    <>
      <header className="header">
        <div className="wrap">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
              </svg>
            </span>
            서울 전동화 입지 인사이트
          </Link>
          <nav className="nav" aria-label="주 메뉴">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} aria-current={section === n.to ? "page" : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
          <button className="theme-toggle" onClick={toggle} aria-label="화면 테마 전환">
            {theme === "light" ? "🌙 다크" : "☀️ 라이트"}
          </button>
        </div>
      </header>
      <main className="wrap">
        {error && <div className="empty">데이터를 불러오지 못했습니다. {error}</div>}
        {!error && !data && <div className="empty">불러오는 중…</div>}
        {data && route(path, data)}
      </main>
      <footer className="footer">
        <div className="wrap">
          <span>데이터: 서울 열린데이터광장 실시간 도로소통정보 · 자동차 등록현황</span>
          {data && (
            <span>
              기준월 {fmtMonth(data.meta.base_month)} · 내보낸 시각 {fmtDateTime(data.meta.exported_at)}
            </span>
          )}
          <a href={REPO_URL}>GitHub</a>
        </div>
      </footer>
    </>
  );
}
