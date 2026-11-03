// 사용자 권한 관리 (관리자): 가입자 목록·역할 지정
import { useCallback, useEffect, useMemo, useState } from "react";
import { PROFILE_COLS, useAuth, type Profile } from "../auth/AuthContext";
import { ROLES, ROLE_DESC, ROLE_LABEL, assignableRoles, canEdit, type Role } from "../auth/roles";
import { supabase } from "../auth/supabase";
import { PageHead } from "../components/PageHead";
import { Avatar } from "../components/UserMenu";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }) : "-";

export function AdminUsers() {
  const { profile: me } = useAuth();
  const [users, setUsers] = useState<Profile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Role | "all">("all");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 목록 조회 (RLS: 관리자는 전체)
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("profiles").select(PROFILE_COLS).order("created_at", { ascending: false });
    if (error) setErr(error.message);
    else setUsers(data as Profile[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: users?.length ?? 0 };
    for (const r of ROLES) c[r] = users?.filter((u) => u.role === r).length ?? 0;
    return c;
  }, [users]);

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (users ?? []).filter(
      (u) =>
        (filter === "all" || u.role === filter) &&
        (!kw || (u.name ?? "").toLowerCase().includes(kw) || (u.email ?? "").toLowerCase().includes(kw)),
    );
  }, [users, filter, q]);

  // 역할 변경 (서버 함수 set_user_role에서 다시 검증)
  const change = async (u: Profile, role: Role) => {
    if (!supabase || role === u.role) return;
    setSaving(u.id);
    setNotice(null);
    const { data, error } = await supabase.rpc("set_user_role", { target: u.id, new_role: role });
    setSaving(null);
    if (error) {
      setNotice(`변경 실패: ${error.message}`);
      return;
    }
    const updated = data as Profile;
    setUsers((list) => list?.map((x) => (x.id === u.id ? { ...x, ...updated } : x)) ?? null);
    setNotice(`${u.name || u.email} → ${ROLE_LABEL[role]}`);
  };

  if (!me) return null;
  const options = assignableRoles(me.is_super);

  return (
    <div className="page">
      <PageHead
        tags={["관리"]}
        title="사용자 권한"
        lede="Google·카카오로 가입한 사용자에게 역할을 지정합니다. 새 가입자는 승인 대기 상태로 시작합니다."
      />

      <section className="card">
        <div className="role-guide">
          {ROLES.map((r) => (
            <div key={r}>
              <span className={`role-badge role-${r}`}>{ROLE_LABEL[r]}</span>
              <small>{ROLE_DESC[r]}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="toolbar admin-tools">
          <div className="filter-row">
            <span className="filter-label">역할</span>
            {(["all", ...ROLES] as const).map((r) => (
              <button key={r} className="chip-btn" aria-pressed={filter === r} onClick={() => setFilter(r)}>
                {r === "all" ? "전체" : ROLE_LABEL[r]} <span className="count">{counts[r]}</span>
              </button>
            ))}
          </div>
          <div className="filter-row">
            <span className="filter-label">검색</span>
            <input type="search" placeholder="이름·이메일" value={q} onChange={(e) => setQ(e.target.value)} aria-label="사용자 검색" />
          </div>
        </div>

        {notice && (
          <p className="admin-notice" role="status">
            {notice}
          </p>
        )}
        {err && <div className="empty">목록을 불러오지 못했습니다. {err}</div>}
        {!err && !users && <div className="empty">불러오는 중…</div>}

        {users && (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>사용자</th>
                  <th>로그인</th>
                  <th className="num">가입</th>
                  <th className="num">역할 변경일</th>
                  <th>역할</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const editable = canEdit(me, u);
                  const name = u.name || u.email || "이름 없음";
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="admin-user">
                          <Avatar name={name} url={u.avatar_url} size={28} />
                          <div>
                            <b>{name}</b>
                            {u.id === me.id && <span className="role-badge role-self">나</span>}
                            <small>{u.email ?? "이메일 미제공"}</small>
                          </div>
                        </div>
                      </td>
                      <td>{u.provider === "kakao" ? "카카오" : u.provider === "google" ? "Google" : u.provider ?? "-"}</td>
                      <td className="num">{fmt(u.created_at)}</td>
                      <td className="num">{fmt(u.role_updated_at)}</td>
                      <td>
                        {u.is_super ? (
                          <span className="role-badge role-super">최고 관리자</span>
                        ) : editable ? (
                          <select
                            className="role-select"
                            value={u.role}
                            disabled={saving === u.id}
                            onChange={(e) => change(u, e.target.value as Role)}
                            aria-label={`${name} 역할`}
                          >
                            {(options.includes(u.role) ? options : [u.role, ...options]).map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`role-badge role-${u.role}`}>{ROLE_LABEL[u.role]}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      해당 사용자가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
