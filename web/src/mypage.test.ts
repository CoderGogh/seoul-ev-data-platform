// 마이페이지: 역할별 구역·팀 담당 집계
import { describe, expect, it } from "vitest";
import { sectionsFor, shortcutsFor, teamBoard } from "./mypage";
import type { WorkItem } from "./work";

const item = (target: string, assignee: string | null, status: WorkItem["status"]): WorkItem => ({
  target, assignee, status, base_month: "202609", updated_by: null, updated_at: "",
});

describe("역할별 구역", () => {
  it("운영자는 보낸 보고, 관리자는 받은 보고함·팀 현황, 대기·조회는 개인 업무 없음", () => {
    expect(sectionsFor("operator")).toContain("sent");
    expect(sectionsFor("operator")).not.toContain("inbox");
    expect(sectionsFor("admin")).toEqual(expect.arrayContaining(["inbox", "team", "users"]));
    expect(sectionsFor("admin")).not.toContain("sent");
    expect(sectionsFor("viewer")).not.toContain("mywork");
    expect(sectionsFor("pending")).toEqual(["pending"]);
    expect(shortcutsFor("admin")).toContain("관리");
    expect(shortcutsFor("operator")).not.toContain("관리");
  });
});

describe("teamBoard", () => {
  it("담당자별 상태 수, 미완료 많은 순, 미지정은 끝", () => {
    const rows = teamBoard(
      [item("region:1", "a", "doing"), item("region:2", "b", "todo"), item("region:3", "b", "hold"), item("region:4", "a", "done"), item("page:/q", null, "todo")],
      [{ id: "a", name: "운영1", role: "operator" }, { id: "b", name: "운영2", role: "operator" }],
    );
    expect(rows.map((r) => [r.name, r.open])).toEqual([["운영2", 2], ["운영1", 1], ["미지정", 1]]);
    expect(rows[1].counts).toEqual({ todo: 0, doing: 1, done: 1, hold: 0 });
  });
});
