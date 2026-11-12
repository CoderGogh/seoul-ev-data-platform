// 오른쪽 바: 현재 화면 안내·화면별 알림·담당·메모(운영 이상)·계정
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABEL, hasRole } from "../auth/roles";
import { useMemo } from "react";
import { pageAlerts } from "../alerts";
import type { AppData } from "../data";
import { groupOf, type NavItem } from "../nav";
import { Link, usePath } from "../router";
import { targetFor } from "../work";
import { Icon } from "./Icon";
import { ReportForm, ReportInbox, SentReports, useTargetLabel } from "./ReportPanel";
import { MyWork, WorkPanel } from "./WorkPanel";

export function Aside({ data, current, isHome }: { data: AppData | null; current?: NavItem; isHome: boolean }) {
  const { enabled, session, profile } = useAuth();
  const path = usePath();
  const group = groupOf(current);
  const operator = hasRole(profile?.role, "operator");
  const alerts = useMemo(() => (data ? pageAlerts(path, data, operator) : []), [path, data, operator]);
  const target = targetFor(path);
  const labelOf = useTargetLabel(data?.regions ?? []);

  return (
    <aside className="aside" aria-label="보조 정보">
      {!isHome && current && group && (
        <section className={`aside-card aside-page tone-${group.tone}`}>
          <span className="tile-icon">
            <Icon name={current.icon} size={18} />
          </span>
          <div>
            <small>{group.title}</small>
            <b>{current.label}</b>
            <p>{current.desc}</p>
          </div>
        </section>
      )}


      {data && (
        <section className="aside-card" aria-label="이 화면 알림">
          <h3>
            이 화면 알림 <span className="aside-count">{alerts.length}</span>
          </h3>
          {alerts.length === 0 ? (
            <p className="work-empty">특이 사항 없음</p>
          ) : (
            <ul className="alert-list">
              {alerts.map((a) => (
                <li key={a.text} className={`alert-item al-${a.tone}`}>
                  <i className="dot" aria-hidden="true" />
                  {a.to && a.to !== path ? <Link to={a.to}>{a.text}</Link> : <span>{a.text}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data && operator && profile && target && <WorkPanel key={target} target={target} baseMonth={data.meta.base_month} me={profile} />}
      {data && profile?.role === "operator" && target && (
        <ReportForm key={target} target={target} label={labelOf(target)} baseMonth={data.meta.base_month} />
      )}
      {data && operator && profile && isHome && <MyWork me={profile} regions={data.regions} />}
      {data && profile?.role === "admin" && isHome && <ReportInbox regions={data.regions} />}
      {data && profile?.role === "operator" && isHome && <SentReports me={profile} regions={data.regions} />}

      {enabled && (
        <section className="aside-card">
          <h3>내 계정</h3>
          {session && profile ? (
            <p className="aside-text">
              <b>{profile.name || profile.email}</b> · <span className={`role-badge role-${profile.role}`}>{ROLE_LABEL[profile.role]}</span>
              <Link to="/me" className="aside-link">
                마이페이지 →
              </Link>
              {hasRole(profile.role, "operator") && (
                <Link to="/versions" className="aside-link">
                  데이터 버전 확인 →
                </Link>
              )}
              {profile.role === "admin" && (
                <Link to="/admin/users" className="aside-link">
                  사용자 권한 관리 →
                </Link>
              )}
            </p>
          ) : (
            <p className="aside-text">
              데이터 운영 화면은 로그인 후 역할을 받으면 열립니다.
              <Link to={`/login?next=${encodeURIComponent(path)}`} className="btn btn-sm btn-primary">
                로그인
              </Link>
            </p>
          )}
        </section>
      )}
    </aside>
  );
}
