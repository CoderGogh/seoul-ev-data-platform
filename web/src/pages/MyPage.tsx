// 마이페이지: 역할별 내 업무·보고·메모·팀 현황·바로가기
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth, type Profile } from "../auth/AuthContext";
import { ROLE_LABEL, type Role } from "../auth/roles";
import { fmtDateTime, fmtMonth, type AppData } from "../data";
import { ROLE_CAN, sectionsFor, shortcutsFor, teamBoard, type Section } from "../mypage";
import { Link } from "../router";
import { CardHead, PageHead } from "../components/PageHead";
import { QuickLinks } from "../components/QuickLinks";
import { useTargetLabel } from "../components/ReportPanel";
import { Avatar } from "../components/UserMenu";
import { StatusBadge, useStaff } from "../components/WorkPanel";
import { STATUS_ORDER, STATUS_TEXT, pathOf, workStore, type Note, type Report, type WorkItem } from "../work";

const LEDE: Record<Role, string> = {
  pending: "가입은 됐고 관리자 승인을 기다리는 중입니다.",
  viewer: "분석 화면을 볼 수 있는 계정입니다.",
  operator: "내 담당, 보낸 보고, 남긴 메모를 한곳에서 봅니다.",
  admin: "받은 보고와 팀 담당 현황, 승인 대기 사용자를 한곳에서 봅니다.",
};

interface Mine {
  items: WorkItem[];
  all: WorkItem[];
  sent: Report[];
  inbox: Report[];
  notes: Note[];
  pending: number | null;
}

const EMPTY: Mine = { items: [], all: [], sent: [], inbox: [], notes: [], pending: null };

// 역할에 필요한 것만 조회
function useMine(me: Profile, sections: Section[]) {
  const [mine, setMine] = useState<Mine | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const has = (s: Section) => sections.includes(s);

  const load = useCallback(async () => {
    if (!workStore) return setMine(EMPTY);
    setErr(null);
    try {
      const s = workStore;
      const [items, all, sent, inbox, notes, pending] = await Promise.all([
        has("mywork") ? s.mine(me.id) : [],
        has("team") ? s.allItems() : [],
        has("sent") ? s.sentReports(me.id, 50) : [],
        has("inbox") ? s.inbox(100) : [],
        has("notes") ? s.myNotes(me.id) : [],
        has("users") ? s.pendingUsers().catch(() => null) : null,
      ]);
      setMine({ items, all, sent, inbox, notes, pending });
    } catch (e) {
      setErr((e as Error).message);
      setMine(EMPTY);
    }
  }, [me.id, sections.join()]);

  useEffect(() => {
    load();
  }, [load]);
  return { mine, setMine, err, setErr };
}

export function MyPage({ data }: { data: AppData }) {
  const { profile } = useAuth();
  if (!profile) return <div className="empty">로그인 정보를 불러오는 중…</div>;
  return <MyPageFor me={profile} data={data} />;
}

function MyPageFor({ me, data }: { me: Profile; data: AppData }) {
  const sections = sectionsFor(me.role);
  const { mine, setMine, err, setErr } = useMine(me, sections);
  const staff = useStaff();
  const nameOf = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);
  const labelOf = useTargetLabel(data.regions);
  const [inboxAll, setInboxAll] = useState(false);
  const has = (s: Section) => sections.includes(s);
  const name = me.name || me.email || "사용자";

  // 변경 후 목록 반영
  const act = async (f: () => Promise<Partial<Mine>>) => {
    setErr(null);
    try {
      const patch = await f();
      setMine((m) => ({ ...(m ?? EMPTY), ...patch }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const sentUnread = mine?.sent.filter((r) => !r.read_at).length ?? 0;
  const inboxUnread = mine?.inbox.filter((r) => !r.read_at).length ?? 0;
  const teamOpen = mine?.all.filter((i) => i.status !== "done").length ?? 0;
  const team = useMemo(() => teamBoard(mine?.all ?? [], staff), [mine?.all, staff]);
  const inbox = (mine?.inbox ?? []).filter((r) => inboxAll || !r.read_at);

  const stats =
    me.role === "admin"
      ? [
          { v: inboxUnread, l: "안 읽은 보고" },
          { v: teamOpen, l: "팀 미완료 담당" },
          { v: mine?.items.length ?? 0, l: "내 미완료 담당" },
          { v: mine?.pending ?? "-", l: "승인 대기 사용자" },
        ]
      : [
          { v: mine?.items.length ?? 0, l: "내 미완료 담당" },
          { v: sentUnread, l: "팀장이 아직 안 읽은 보고" },
          { v: mine?.sent.length ?? 0, l: "보낸 보고" },
          { v: mine?.notes.length ?? 0, l: "내가 남긴 메모" },
        ];

  return (
    <div className="page">
      <PageHead tags={["마이페이지", ROLE_LABEL[me.role]]} title={`${name}님`} lede={LEDE[me.role]} />

      <section className="card card-body me-profile">
        <Avatar name={name} url={me.avatar_url} size={56} />
        <div className="me-profile-main">
          <div className="me-profile-name">
            <b>{name}</b>
            <span className={`role-badge role-${me.role}`}>{ROLE_LABEL[me.role]}</span>
            {me.is_super && <span className="role-badge role-super">최고 관리자</span>}
          </div>
          <small>
            {me.email ?? "이메일 없음"}
            {me.provider && ` · ${me.provider === "kakao" ? "카카오" : "Google"} 로그인`}
            {me.created_at && ` · 가입 ${fmtDateTime(me.created_at)}`}
          </small>
        </div>
        <div className="me-can">
          <small>할 수 있는 일</small>
          <ul>
            {ROLE_CAN[me.role].map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </section>

      {err && <div className="alert alert-warning">일부를 불러오지 못했습니다. {err}</div>}

      {has("pending") && (
        <section className="card card-body">
          <CardHead title="승인 대기" sub="관리자가 역할을 지정하면 이 화면에 업무가 나타납니다" />
          <p className="me-text">
            지금은 공개 분석 화면만 볼 수 있습니다. <Link to="/">대시보드로 가기</Link>
          </p>
        </section>
      )}

      {has("guide") && (
        <section className="card card-body">
          <CardHead title="권한 안내" />
          <p className="me-text">데이터 운영 화면, 담당·메모·보고가 필요하면 관리자에게 운영 권한을 요청하세요.</p>
        </section>
      )}

      {has("stats") && (
        <section className="stats" aria-label="요약">
          {stats.map((s) => (
            <div className="stat" key={s.l}>
              <div className="stat-value">{mine ? s.v : "…"}</div>
              <div className="stat-label">{s.l}</div>
            </div>
          ))}
        </section>
      )}

      {has("inbox") && (
        <section className="card card-body">
          <CardHead
            title="받은 보고함"
            sub={`안 읽음 ${inboxUnread}건 · 최근 100건`}
            action={
              <div className="btn-group btn-group-sm" role="group" aria-label="보고 필터">
                <button type="button" className={`btn ${!inboxAll ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setInboxAll(false)}>
                  안 읽음
                </button>
                <button type="button" className={`btn ${inboxAll ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setInboxAll(true)}>
                  전체
                </button>
              </div>
            }
          />
          {mine && inbox.length === 0 && <p className="work-empty">{inboxAll ? "받은 보고가 없습니다." : "안 읽은 보고가 없습니다."}</p>}
          <ul className="me-list">
            {inbox.map((r) => (
              <li key={r.id} className={r.read_at ? "report-read" : undefined}>
                <div className="me-row-head">
                  <b>{nameOf.get(r.author) ?? "운영 담당"}</b>
                  <Link to={pathOf(r.target)}>{labelOf(r.target)}</Link>
                  <small>
                    {fmtDateTime(r.created_at)}
                    {r.base_month && ` · ${fmtMonth(r.base_month)} 기준`}
                  </small>
                  <span className={`work-badge ${r.read_at ? "work-done" : "work-todo"}`}>
                    {r.read_at ? `읽음 ${fmtDateTime(r.read_at)}` : "안 읽음"}
                  </span>
                </div>
                <p>{r.body}</p>
                <div className="report-actions">
                  {!r.read_at && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      onClick={() =>
                        act(async () => {
                          const at = await workStore!.markRead(r.id);
                          return { inbox: mine!.inbox.map((x) => (x.id === r.id ? { ...x, read_at: x.read_at ?? at } : x)) };
                        })
                      }
                    >
                      읽음
                    </button>
                  )}
                  <button
                    type="button"
                    className="work-del"
                    onClick={() =>
                      act(async () => {
                        await workStore!.deleteReport(r.id);
                        return { inbox: mine!.inbox.filter((x) => x.id !== r.id) };
                      })
                    }
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {has("team") && (
        <section className="card card-body">
          <CardHead title="팀 담당 현황" sub={`담당 기록 ${mine?.all.length ?? 0}건`} />
          {mine && team.length === 0 ? (
            <p className="work-empty">지정된 담당이 없습니다.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover table-sm me-team">
                <thead>
                  <tr>
                    <th>담당자</th>
                    {STATUS_ORDER.map((s) => (
                      <th key={s} className="num">
                        {STATUS_TEXT[s]}
                      </th>
                    ))}
                    <th className="num">미완료</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((t) => (
                    <tr key={t.id ?? "none"}>
                      <td>{t.name}</td>
                      {STATUS_ORDER.map((s) => (
                        <td key={s} className="num">
                          {t.counts[s] || "-"}
                        </td>
                      ))}
                      <td className="num">
                        <b>{t.open}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {has("mywork") && (
        <section className="card card-body">
          <CardHead title="내 담당" sub="완료 전 항목, 최근 변경 순" />
          {mine && mine.items.length === 0 && <p className="work-empty">지정된 항목이 없습니다.</p>}
          {mine && mine.items.length > 0 && (
            <div className="table-responsive">
              <table className="table table-hover table-sm">
                <thead>
                  <tr>
                    <th>대상</th>
                    <th>진행</th>
                    <th>기준월</th>
                    <th>변경</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.items.map((i) => (
                    <tr key={i.target}>
                      <td>
                        <Link to={pathOf(i.target)}>{labelOf(i.target)}</Link>
                      </td>
                      <td>
                        <StatusBadge status={i.status} />
                      </td>
                      <td>{i.base_month ? fmtMonth(i.base_month) : "-"}</td>
                      <td>
                        {nameOf.get(i.updated_by ?? "") ?? "-"} · {fmtDateTime(i.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {has("sent") && (
        <section className="card card-body">
          <CardHead title="보낸 보고" sub="읽기 전에는 삭제할 수 있음 · 최근 50건" />
          {mine && mine.sent.length === 0 && (
            <p className="work-empty">보낸 보고가 없습니다. 동 상세나 운영 화면 오른쪽 바에서 보낼 수 있습니다.</p>
          )}
          <ul className="me-list">
            {mine?.sent.map((r) => (
              <li key={r.id}>
                <div className="me-row-head">
                  <Link to={pathOf(r.target)}>{labelOf(r.target)}</Link>
                  <small>{fmtDateTime(r.created_at)}</small>
                  <span className={`work-badge ${r.read_at ? "work-done" : "work-todo"}`}>
                    {r.read_at ? `읽음 ${fmtDateTime(r.read_at)}` : "안 읽음"}
                  </span>
                  {!r.read_at && (
                    <button
                      type="button"
                      className="work-del"
                      onClick={() =>
                        act(async () => {
                          await workStore!.deleteReport(r.id);
                          return { sent: mine!.sent.filter((x) => x.id !== r.id) };
                        })
                      }
                    >
                      삭제
                    </button>
                  )}
                </div>
                <p>{r.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {has("notes") && (
        <section className="card card-body">
          <CardHead title="내가 남긴 메모" sub="최근 20건" />
          {mine && mine.notes.length === 0 && <p className="work-empty">남긴 메모가 없습니다.</p>}
          <ul className="me-list">
            {mine?.notes.map((n) => (
              <li key={n.id}>
                <div className="me-row-head">
                  <Link to={pathOf(n.target)}>{labelOf(n.target)}</Link>
                  <small>{fmtDateTime(n.created_at)}</small>
                  {n.base_month && n.base_month !== data.meta.base_month && <span className="work-stale">{fmtMonth(n.base_month)} 기준</span>}
                  <button
                    type="button"
                    className="work-del"
                    onClick={() =>
                      act(async () => {
                        await workStore!.deleteNote(n.id);
                        return { notes: mine!.notes.filter((x) => x.id !== n.id) };
                      })
                    }
                  >
                    삭제
                  </button>
                </div>
                <p>{n.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {has("users") && (
        <section className="card card-body">
          <CardHead title="사용자 권한" />
          <p className="me-text">
            승인 대기 <b>{mine?.pending ?? "-"}명</b>.{" "}
            <Link to="/admin/users" className="btn btn-sm btn-primary">
              사용자 권한 관리
            </Link>
          </p>
        </section>
      )}

      {has("shortcuts") && <QuickLinks role={me.role} only={shortcutsFor(me.role)} />}
    </div>
  );
}
