// 오른쪽 바: 현재 화면 안내·데이터 기준일·우선 검토 바로가기·계정
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABEL, hasRole } from "../auth/roles";
import { fmtInt, type AppData } from "../data";
import { groupOf, type NavItem } from "../nav";
import { Link, usePath } from "../router";
import { HintBadge } from "./Badges";
import { Icon } from "./Icon";

export function Aside({ data, current, isHome }: { data: AppData | null; current?: NavItem; isHome: boolean }) {
  const { enabled, session, profile } = useAuth();
  const path = usePath();
  const group = groupOf(current);
  const top = data ? data.regions.filter((r) => r.classification === "A").slice(0, 5) : [];

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


      {top.length > 0 && (
        <section className="aside-card">
          <h3>
            우선 검토 지역 <Link to="/priority">전체</Link>
          </h3>
          <ol className="aside-rank">
            {top.map((r, i) => (
              <li key={r.adm_cd}>
                <Link to={`/regions/${r.adm_cd}`}>
                  <span className="aside-no">{i + 1}</span>
                  <span className="aside-name">
                    {r.adm_nm}
                    <small>
                      {r.sgg_nm} · {fmtInt(r.ev_cnt)}대
                    </small>
                  </span>
                  <HintBadge value={r.charger_hint} />
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {enabled && (
        <section className="aside-card">
          <h3>내 계정</h3>
          {session && profile ? (
            <p className="aside-text">
              <b>{profile.name || profile.email}</b> · <span className={`role-badge role-${profile.role}`}>{ROLE_LABEL[profile.role]}</span>
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
              <Link to={`/login?next=${encodeURIComponent(path)}`} className="btn btn-sm">
                로그인
              </Link>
            </p>
          )}
        </section>
      )}
    </aside>
  );
}
