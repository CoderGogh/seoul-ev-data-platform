// 오른쪽 바 협업: 담당자·진행 상태·메모 (운영 이상), 첫 화면은 내 담당
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Profile } from "../auth/AuthContext";
import { fmtDateTime, fmtMonth, type Region } from "../data";
import { activeItem } from "../nav";
import { Link } from "../router";
import {
  STATUS_ORDER,
  STATUS_TEXT,
  pathOf,
  workStore,
  type Note,
  type Staff,
  type WorkItem,
  type WorkStatus,
} from "../work";

// 담당자 후보 (한 번 조회 후 공유)
let staffCache: Promise<Staff[]> | null = null;
function useStaff() {
  const [staff, setStaff] = useState<Staff[]>([]);
  useEffect(() => {
    if (!workStore) return;
    staffCache ??= workStore.staff().catch(() => []);
    staffCache.then(setStaff);
  }, []);
  return staff;
}

export function StatusBadge({ status }: { status: WorkStatus }) {
  return <span className={`work-badge work-${status}`}>{STATUS_TEXT[status]}</span>;
}

interface WorkPanelProps {
  target: string;
  baseMonth: string;
  me: Profile;
}

export function WorkPanel({ target, baseMonth, me }: WorkPanelProps) {
  const staff = useStaff();
  const nameOf = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);
  const [item, setItem] = useState<WorkItem | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 대상 바뀌면 다시 조회
  const load = useCallback(async () => {
    if (!workStore) return;
    setErr(null);
    try {
      const [i, n] = await Promise.all([workStore.item(target), workStore.notes(target)]);
      setItem(i);
      setNotes(n);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [target]);

  useEffect(() => {
    setItem(null);
    setNotes(null);
    setDraft("");
    load();
  }, [load]);

  if (!workStore) return null;

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = (patch: { assignee?: string | null; status?: WorkStatus }) =>
    run(async () => setItem(await workStore!.saveItem(target, patch, baseMonth)));

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    run(async () => {
      const n = await workStore!.addNote(target, draft, baseMonth);
      setNotes((list) => [n, ...(list ?? [])]);
      setDraft("");
    });
  };

  const remove = (id: number) =>
    run(async () => {
      await workStore!.deleteNote(id);
      setNotes((list) => list?.filter((n) => n.id !== id) ?? null);
    });

  const status = item?.status ?? "todo";

  return (
    <section className="aside-card work-panel" aria-label="담당·메모">
      <h3>담당·메모</h3>

      <label className="work-field">
        <span>담당자</span>
        <select
          className="form-select form-select-sm"
          value={item?.assignee ?? ""}
          disabled={busy}
          onChange={(e) => save({ assignee: e.target.value || null })}
        >
          <option value="">미지정</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.role === "admin" ? " (팀장)" : ""}
            </option>
          ))}
        </select>
      </label>

      <div className="work-field">
        <span>진행</span>
        <div className="btn-group btn-group-sm work-status" role="group" aria-label="진행 상태">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              className={`btn ${status === s ? "btn-primary" : "btn-outline-secondary"}`}
              aria-pressed={status === s}
              disabled={busy}
              onClick={() => save({ status: s })}
            >
              {STATUS_TEXT[s]}
            </button>
          ))}
        </div>
      </div>
      {item && (
        <small className="work-meta">
          {nameOf.get(item.updated_by ?? "") ?? "알 수 없음"} · {fmtDateTime(item.updated_at)}
        </small>
      )}

      <form className="work-note-form" onSubmit={add}>
        <textarea
          className="form-control form-control-sm"
          rows={2}
          maxLength={1000}
          placeholder="메모 (현장 조사 결과, 확인할 점 등)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="메모 입력"
        />
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !draft.trim()}>
          메모 남기기
        </button>
      </form>

      {err && <p className="work-err">저장하지 못했습니다. {err}</p>}
      {notes === null && !err && <p className="work-empty">불러오는 중…</p>}
      {notes?.length === 0 && <p className="work-empty">아직 메모가 없습니다.</p>}
      {notes && notes.length > 0 && (
        <ul className="work-notes">
          {notes.map((n) => (
            <li key={n.id}>
              <div className="work-note-head">
                <b>{nameOf.get(n.author) ?? "이전 담당자"}</b>
                <small>{fmtDateTime(n.created_at)}</small>
                {n.base_month && n.base_month !== baseMonth && (
                  <span className="work-stale" title="메모를 남긴 뒤 데이터가 다시 게시됨">
                    {fmtMonth(n.base_month)} 기준
                  </span>
                )}
                {(n.author === me.id || me.role === "admin") && (
                  <button type="button" className="work-del" onClick={() => remove(n.id)} disabled={busy} aria-label="메모 삭제">
                    삭제
                  </button>
                )}
              </div>
              <p>{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// 첫 화면: 나에게 지정된 미완료 항목
export function MyWork({ me, regions }: { me: Profile; regions: Region[] }) {
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const names = useMemo(() => new Map(regions.map((r) => [`region:${r.adm_cd}`, r.adm_nm])), [regions]);

  useEffect(() => {
    workStore?.mine(me.id).then(setItems, () => setItems([]));
  }, [me.id]);

  if (!workStore) return null;
  return (
    <section className="aside-card" aria-label="내 담당">
      <h3>내 담당</h3>
      {items === null && <p className="work-empty">불러오는 중…</p>}
      {items?.length === 0 && <p className="work-empty">지정된 항목이 없습니다.</p>}
      {items && items.length > 0 && (
        <ul className="work-mine">
          {items.map((i) => (
            <li key={i.target}>
              <Link to={pathOf(i.target)}>
                <span>{names.get(i.target) ?? activeItem(pathOf(i.target))?.label ?? pathOf(i.target)}</span>
                <StatusBadge status={i.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
