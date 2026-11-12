// 팀장 보고: 운영자 보고 작성·보낸 보고, 팀장 받은 보고함 (Slack 알림은 Edge Function)
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Profile } from "../auth/AuthContext";
import { fmtDateTime, type Region } from "../data";
import { activeItem } from "../nav";
import { Link } from "../router";
import { pathOf, workStore, type Report } from "../work";
import { useStaff } from "./WorkPanel";

// 대상 키 → 표시 이름 (동 이름·화면 이름)
export function useTargetLabel(regions: Region[]) {
  const names = useMemo(() => new Map(regions.map((r) => [`region:${r.adm_cd}`, r.adm_nm])), [regions]);
  return (target: string) => names.get(target) ?? activeItem(pathOf(target))?.label ?? pathOf(target);
}

function ReadBadge({ read }: { read: boolean }) {
  return <span className={`work-badge ${read ? "work-done" : "work-todo"}`}>{read ? "읽음" : "안 읽음"}</span>;
}

// 보고 작성 (운영자, 현재 화면·동 대상)
export function ReportForm({ target, label, baseMonth }: { target: string; label: string; baseMonth: string }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!workStore) return null;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await workStore!.sendReport(target, draft, baseMonth);
      setDraft("");
      const notified = await workStore!.notifyReport(r.id, label).catch(() => false);
      setMsg(notified ? "보냈습니다. Slack 알림도 갔습니다." : "보냈습니다. 팀장 보고함에서 확인합니다.");
    } catch (err) {
      setMsg(`보내지 못했습니다. ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="aside-card work-panel" aria-label="팀장 보고">
      <h3>팀장 보고</h3>
      <form className="work-note-form" onSubmit={send}>
        <textarea
          className="form-control form-control-sm"
          rows={3}
          maxLength={2000}
          placeholder={`${label} 관련 보고 (결과, 판단 필요한 점)`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="보고 입력"
        />
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !draft.trim()}>
          보고 보내기
        </button>
      </form>
      {msg && <p className="work-empty">{msg}</p>}
    </section>
  );
}

// 보낸 보고 (운영자 첫 화면)
export function SentReports({ me, regions }: { me: Profile; regions: Region[] }) {
  const [list, setList] = useState<Report[] | null>(null);
  const labelOf = useTargetLabel(regions);

  useEffect(() => {
    workStore?.sentReports(me.id).then(setList, () => setList([]));
  }, [me.id]);

  if (!workStore) return null;
  return (
    <section className="aside-card" aria-label="보낸 보고">
      <h3>보낸 보고</h3>
      {list === null && <p className="work-empty">불러오는 중…</p>}
      {list?.length === 0 && <p className="work-empty">보낸 보고가 없습니다.</p>}
      {list && list.length > 0 && (
        <ul className="work-mine">
          {list.map((r) => (
            <li key={r.id}>
              <Link to={pathOf(r.target)}>
                <span>
                  {labelOf(r.target)} <small>{fmtDateTime(r.created_at)}</small>
                </span>
                <ReadBadge read={r.read_at !== null} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// 받은 보고함 (팀장 첫 화면): 안 읽음 먼저, 읽음 처리·삭제
export function ReportInbox({ regions }: { regions: Region[] }) {
  const staff = useStaff();
  const [list, setList] = useState<Report[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const labelOf = useTargetLabel(regions);
  const nameOf = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);

  useEffect(() => {
    workStore?.inbox().then(setList, (e) => setErr((e as Error).message));
  }, []);

  if (!workStore) return null;
  const unread = list?.filter((r) => !r.read_at).length ?? 0;

  const act = async (f: () => Promise<Report[]>) => {
    setErr(null);
    try {
      setList(await f());
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const read = (id: number) =>
    act(async () => {
      const at = await workStore!.markRead(id);
      return (list ?? []).map((r) => (r.id === id ? { ...r, read_at: r.read_at ?? at } : r));
    });
  const remove = (id: number) =>
    act(async () => {
      await workStore!.deleteReport(id);
      return (list ?? []).filter((r) => r.id !== id);
    });

  return (
    <section className="aside-card" aria-label="받은 보고함">
      <h3>
        받은 보고함 <span className="aside-count">{unread}</span>
      </h3>
      {err && <p className="work-err">불러오지 못했습니다. {err}</p>}
      {list === null && !err && <p className="work-empty">불러오는 중…</p>}
      {list?.length === 0 && <p className="work-empty">받은 보고가 없습니다.</p>}
      {list && list.length > 0 && (
        <ul className="work-notes">
          {list.map((r) => (
            <li key={r.id} className={r.read_at ? "report-read" : undefined}>
              <div className="work-note-head">
                <b>{nameOf.get(r.author) ?? "운영 담당"}</b>
                <Link to={pathOf(r.target)}>{labelOf(r.target)}</Link>
                <small>{fmtDateTime(r.created_at)}</small>
                <ReadBadge read={r.read_at !== null} />
              </div>
              <p>{r.body}</p>
              <div className="report-actions">
                {!r.read_at && (
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => read(r.id)}>
                    읽음
                  </button>
                )}
                <button type="button" className="work-del" onClick={() => remove(r.id)} aria-label="보고 삭제">
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
