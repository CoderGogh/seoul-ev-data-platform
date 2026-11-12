// 상단 바 사용자 메뉴: 로그인 버튼 또는 프로필·역할·로그아웃
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABEL, hasRole } from "../auth/roles";
import { Link, usePath } from "../router";
import { Icon } from "./Icon";

export function Avatar({ name, url, size = 30 }: { name: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken)
    return (
      <img className="avatar" src={url} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    );
  return (
    <span className="avatar avatar-text" style={{ width: size, height: size }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function UserMenu() {
  const { enabled, loading, session, profile, signOut } = useAuth();
  const path = usePath();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 바깥 클릭·Esc·이동 시 닫기
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!enabled) return null;
  if (!session) {
    if (loading) return null;
    const next = path === "/login" ? "/" : path;
    return (
      <Link to={`/login?next=${encodeURIComponent(next)}`} className="btn btn-sm btn-primary">
        로그인
      </Link>
    );
  }

  const name = profile?.name || profile?.email || session.user.email || "사용자";
  return (
    <div className="dropdown" ref={ref}>
      <button className="btn btn-link user-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="사용자 메뉴">
        <Avatar name={name} url={profile?.avatar_url} />
      </button>
      {open && (
        <div className="dropdown-menu dropdown-menu-end show user-panel" role="dialog" aria-label="사용자 메뉴">
          <div className="user-head">
            <Avatar name={name} url={profile?.avatar_url} size={40} />
            <div>
              <b>{name}</b>
              <small>{profile?.email ?? session.user.email}</small>
            </div>
          </div>
          <div className="user-role">
            <span className={`role-badge role-${profile?.role ?? "pending"}`}>
              {profile ? ROLE_LABEL[profile.role] : "프로필 없음"}
            </span>
            {profile?.is_super && <span className="role-badge role-super">최고 관리자</span>}
            {profile?.provider && <small>{profile.provider === "kakao" ? "카카오" : "Google"} 로그인</small>}
          </div>
          {profile?.role === "pending" && <p className="user-note">관리자가 역할을 지정하면 운영 화면을 볼 수 있습니다.</p>}
          <div className="dropdown-divider" />
          {hasRole(profile?.role, "operator") && (
            <Link to="/versions" className="dropdown-item">
              <Icon name="clock" size={16} /> 데이터 버전
            </Link>
          )}
          {profile?.role === "admin" && (
            <Link to="/admin/users" className="dropdown-item">
              <Icon name="users" size={16} /> 사용자 권한 관리
            </Link>
          )}
          <button className="dropdown-item" onClick={() => signOut()}>
            <Icon name="logout" size={16} /> 로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
