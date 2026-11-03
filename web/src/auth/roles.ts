// 역할 등급·표시 이름
export type Role = "pending" | "viewer" | "operator" | "admin";

export const ROLES: Role[] = ["pending", "viewer", "operator", "admin"];

const RANK: Record<Role, number> = { pending: 0, viewer: 1, operator: 2, admin: 3 };

export const ROLE_LABEL: Record<Role, string> = {
  pending: "승인 대기",
  viewer: "조회",
  operator: "운영",
  admin: "관리자",
};

export const ROLE_DESC: Record<Role, string> = {
  pending: "가입 직후, 운영 화면 접근 불가",
  viewer: "분석 화면 조회",
  operator: "데이터 운영 화면(품질·파이프라인·진행) 조회",
  admin: "사용자 역할 관리",
};

// 요구 등급 충족 여부 (요구 없음은 공개)
export function hasRole(role: Role | null | undefined, min?: Role): boolean {
  if (!min) return true;
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

// 관리자가 지정할 수 있는 역할 (admin은 최고 관리자만)
export function assignableRoles(isSuper: boolean): Role[] {
  return isSuper ? ROLES : ROLES.filter((r) => r !== "admin");
}

// 역할 변경 가능 대상 여부
export function canEdit(me: { id: string; role: Role; is_super: boolean }, target: { id: string; role: Role; is_super: boolean }): boolean {
  if (me.role !== "admin" || me.id === target.id || target.is_super) return false;
  return me.is_super || target.role !== "admin";
}
