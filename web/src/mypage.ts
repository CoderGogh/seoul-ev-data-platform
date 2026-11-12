// 마이페이지: 역할별 구역·바로가기·팀 담당 현황
import type { Role } from "./auth/roles";
import { STATUS_ORDER, type Staff, type WorkItem, type WorkStatus } from "./work";

export type Section = "pending" | "guide" | "stats" | "mywork" | "sent" | "notes" | "inbox" | "team" | "users" | "shortcuts";

// 역할별 표시 구역 (위에서 아래 순서)
const SECTIONS: Record<Role, Section[]> = {
  pending: ["pending"],
  viewer: ["guide", "shortcuts"],
  operator: ["stats", "mywork", "sent", "notes", "shortcuts"],
  admin: ["stats", "inbox", "team", "mywork", "users", "shortcuts"],
};
export const sectionsFor = (role: Role) => SECTIONS[role];

// 역할별 바로가기 카테고리
const SHORTCUTS: Record<Role, string[]> = {
  pending: [],
  viewer: ["지역 분석", "지표 분석"],
  operator: ["데이터 운영"],
  admin: ["데이터 운영", "관리"],
};
export const shortcutsFor = (role: Role) => SHORTCUTS[role];

// 역할별 할 수 있는 일
export const ROLE_CAN: Record<Role, string[]> = {
  pending: ["관리자가 역할을 지정하기 전까지 공개 분석 화면만 볼 수 있음"],
  viewer: ["지역·지표 분석 화면 조회", "운영 화면은 운영 권한 필요"],
  operator: ["데이터 운영 화면 조회", "동·화면 담당 지정과 진행 상태 변경", "메모 작성", "팀장에게 보고"],
  admin: ["운영 권한 전부", "받은 보고 확인·읽음 처리", "담당 기록·메모 삭제", "사용자 역할 지정"],
};

export interface TeamRow {
  id: string | null; // null = 미지정
  name: string;
  counts: Record<WorkStatus, number>;
  open: number; // 완료 외
}

// 담당자별 진행 상태 집계 (미완료 많은 순, 미지정은 끝)
export function teamBoard(items: WorkItem[], staff: Staff[]): TeamRow[] {
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const rows = new Map<string | null, TeamRow>();
  for (const i of items) {
    const key = i.assignee;
    const row = rows.get(key) ?? {
      id: key,
      name: key ? (names.get(key) ?? "이전 담당자") : "미지정",
      counts: Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<WorkStatus, number>,
      open: 0,
    };
    row.counts[i.status] += 1;
    if (i.status !== "done") row.open += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => Number(a.id === null) - Number(b.id === null) || b.open - a.open || a.name.localeCompare(b.name, "ko"));
}
