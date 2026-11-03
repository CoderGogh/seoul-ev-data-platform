// 권한 화면 관문: 비로그인·권한 부족 시 안내
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABEL, hasRole, type Role } from "../auth/roles";
import { Link } from "../router";
import { Icon } from "./Icon";

export function RequireRole({ min, path, children }: { min?: Role; path: string; children: ReactNode }) {
  const { enabled, loading, session, profile } = useAuth();
  if (!min) return <>{children}</>;
  if (loading) return <div className="empty">권한 확인 중…</div>;
  if (hasRole(profile?.role, min)) return <>{children}</>;

  let msg: ReactNode;
  if (!enabled) msg = "로그인 기능이 설정되지 않은 배포입니다.";
  else if (!session)
    msg = (
      <>
        로그인 후 볼 수 있는 화면입니다.{" "}
        <Link to={`/login?next=${encodeURIComponent(path)}`} className="btn btn-sm">
          로그인
        </Link>
      </>
    );
  else msg = `${ROLE_LABEL[min]} 이상 권한이 필요합니다. 현재 권한: ${profile ? ROLE_LABEL[profile.role] : "없음"}`;

  return (
    <div className="access-gate">
      <Icon name="lock" size={28} />
      <h2>접근 권한 필요</h2>
      <p>{msg}</p>
    </div>
  );
}
