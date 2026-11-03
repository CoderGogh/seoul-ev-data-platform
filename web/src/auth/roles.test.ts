import { describe, expect, it } from "vitest";
import { assignableRoles, canEdit, hasRole } from "./roles";

describe("hasRole", () => {
  it("요구 없음은 공개", () => {
    expect(hasRole(null)).toBe(true);
  });
  it("비로그인·대기는 운영 화면 불가", () => {
    expect(hasRole(null, "operator")).toBe(false);
    expect(hasRole("pending", "operator")).toBe(false);
    expect(hasRole("viewer", "operator")).toBe(false);
  });
  it("상위 역할은 하위 요구 충족", () => {
    expect(hasRole("operator", "operator")).toBe(true);
    expect(hasRole("admin", "operator")).toBe(true);
  });
});

describe("역할 변경 규칙", () => {
  const sup = { id: "s", role: "admin" as const, is_super: true };
  const adm = { id: "a", role: "admin" as const, is_super: false };
  const usr = { id: "u", role: "pending" as const, is_super: false };

  it("admin 지정은 최고 관리자만", () => {
    expect(assignableRoles(true)).toContain("admin");
    expect(assignableRoles(false)).not.toContain("admin");
  });
  it("본인·최고 관리자는 변경 불가", () => {
    expect(canEdit(sup, sup)).toBe(false);
    expect(canEdit(adm, sup)).toBe(false);
  });
  it("일반 관리자는 다른 관리자 변경 불가", () => {
    expect(canEdit(adm, { ...adm, id: "b" })).toBe(false);
    expect(canEdit(sup, adm)).toBe(true);
    expect(canEdit(adm, usr)).toBe(true);
  });
  it("관리자 아니면 변경 불가", () => {
    expect(canEdit({ ...usr, role: "operator" }, { ...usr, id: "x" })).toBe(false);
  });
});

import { safeNext } from "./next";

describe("safeNext", () => {
  it("내부 경로만 허용", () => {
    expect(safeNext("/quality")).toBe("/quality");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("/login?next=/x")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
