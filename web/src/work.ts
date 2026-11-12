// 화면별 담당자·진행 상태·메모 저장소 (Supabase, 로컬 미리보기는 메모리)
import type { Role } from "./auth/roles";
import { DEV_ROLE } from "./auth/AuthContext";
import { supabase } from "./auth/supabase";

export type WorkStatus = "todo" | "doing" | "done" | "hold";

export const STATUS_TEXT: Record<WorkStatus, string> = {
  todo: "검토 전",
  doing: "진행 중",
  done: "완료",
  hold: "보류",
};
export const STATUS_ORDER: WorkStatus[] = ["todo", "doing", "done", "hold"];

export interface Staff {
  id: string;
  name: string;
  role: Role;
}

export interface WorkItem {
  target: string;
  assignee: string | null;
  status: WorkStatus;
  base_month: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface Note {
  id: number;
  target: string;
  body: string;
  base_month: string | null;
  author: string;
  created_at: string;
}

export interface WorkStore {
  staff(): Promise<Staff[]>;
  item(target: string): Promise<WorkItem | null>;
  items(prefix: string): Promise<WorkItem[]>;
  mine(uid: string): Promise<WorkItem[]>;
  saveItem(target: string, patch: { assignee?: string | null; status?: WorkStatus }, baseMonth: string): Promise<WorkItem>;
  notes(target: string): Promise<Note[]>;
  addNote(target: string, body: string, baseMonth: string): Promise<Note>;
  deleteNote(id: number): Promise<void>;
}

// 화면 경로 → 대상 키 (동 상세는 동 단위, 대시보드는 없음)
export function targetFor(path: string): string | null {
  const m = path.match(/^\/regions\/(\d{10})$/);
  if (m) return `region:${m[1]}`;
  if (path === "/" || path === "/login" || path.startsWith("/admin")) return null;
  return /^\/[a-z-]+$/.test(path) ? `page:${path}` : null;
}

// 대상 키 → 이동 경로
export const pathOf = (target: string) => (target.startsWith("region:") ? `/regions/${target.slice(7)}` : target.slice(5));

const MAX_NOTE = 1000;
export const cleanNote = (body: string) => body.trim().slice(0, MAX_NOTE);

// 오류 → 예외
function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const ITEM_COLS = "target,assignee,status,base_month,updated_by,updated_at";
const NOTE_COLS = "id,target,body,base_month,author,created_at";

function supabaseStore(): WorkStore {
  const db = supabase!;
  return {
    staff: async () => must(await db.rpc("list_staff")) as Staff[],
    item: async (target) => must(await db.from("work_items").select(ITEM_COLS).eq("target", target).maybeSingle()) as WorkItem | null,
    items: async (prefix) => must(await db.from("work_items").select(ITEM_COLS).like("target", `${prefix}%`)) as WorkItem[],
    mine: async (uid) =>
      must(await db.from("work_items").select(ITEM_COLS).eq("assignee", uid).neq("status", "done").order("updated_at", { ascending: false })) as WorkItem[],
    saveItem: async (target, patch, baseMonth) =>
      must(
        await db
          .from("work_items")
          .upsert({ target, base_month: baseMonth, ...patch }, { onConflict: "target" })
          .select(ITEM_COLS)
          .single(),
      ) as WorkItem,
    notes: async (target) =>
      must(await db.from("notes").select(NOTE_COLS).eq("target", target).order("created_at", { ascending: false }).limit(50)) as Note[],
    addNote: async (target, body, baseMonth) =>
      must(await db.from("notes").insert({ target, body: cleanNote(body), base_month: baseMonth }).select(NOTE_COLS).single()) as Note,
    deleteNote: async (id) => {
      must(await db.from("notes").delete().eq("id", id));
    },
  };
}

// 로컬 미리보기: 브라우저 메모리 (새로고침 시 초기화)
export function memoryStore(): WorkStore {
  const staff: Staff[] = [
    { id: "dev", name: "로컬 미리보기", role: DEV_ROLE ?? "operator" },
    { id: "lead", name: "팀장 (예시)", role: "admin" },
    { id: "op", name: "운영 담당 (예시)", role: "operator" },
  ];
  const items = new Map<string, WorkItem>();
  let notes: Note[] = [];
  let seq = 0;
  return {
    staff: async () => staff,
    item: async (t) => items.get(t) ?? null,
    items: async (prefix) => [...items.values()].filter((i) => i.target.startsWith(prefix)),
    mine: async (uid) => [...items.values()].filter((i) => i.assignee === uid && i.status !== "done"),
    saveItem: async (target, patch, baseMonth) => {
      const prev = items.get(target) ?? { target, assignee: null, status: "todo" as WorkStatus };
      const next = { ...prev, ...patch, base_month: baseMonth, updated_by: "dev", updated_at: new Date().toISOString() };
      items.set(target, next);
      return next;
    },
    notes: async (t) => notes.filter((n) => n.target === t),
    addNote: async (target, body, baseMonth) => {
      const n = { id: ++seq, target, body: cleanNote(body), base_month: baseMonth, author: "dev", created_at: new Date().toISOString() };
      notes = [n, ...notes];
      return n;
    },
    deleteNote: async (id) => {
      notes = notes.filter((n) => n.id !== id);
    },
  };
}

export const workStore: WorkStore | null = supabase ? supabaseStore() : DEV_ROLE ? memoryStore() : null;
