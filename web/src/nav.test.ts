import { describe, expect, it } from "vitest";
import { visibleGroups } from "./nav";

const paths = (role: Parameters<typeof visibleGroups>[0]) => visibleGroups(role).flatMap((g) => g.items.map((i) => i.to));

describe("visibleGroups", () => {
  it("비로그인·대기·조회는 데이터 버전·사용자 권한 숨김", () => {
    for (const r of [null, "pending", "viewer"] as const) {
      expect(paths(r)).not.toContain("/versions");
      expect(paths(r)).not.toContain("/admin/users");
    }
  });
  it("잠금 표시 메뉴는 권한 없어도 노출", () => {
    expect(paths(null)).toContain("/quality");
  });
  it("운영은 데이터 버전만, 관리자는 둘 다", () => {
    expect(paths("operator")).toContain("/versions");
    expect(paths("operator")).not.toContain("/admin/users");
    expect(paths("admin")).toEqual(expect.arrayContaining(["/versions", "/admin/users"]));
  });
});
