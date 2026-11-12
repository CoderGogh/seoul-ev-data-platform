// 담당·메모: 대상 키, 메모 정리, 미리보기 저장소 흐름
import { describe, expect, it } from "vitest";
import { cleanNote, memoryStore, pathOf, targetFor } from "./work";

describe("대상 키", () => {
  it("동 상세는 동 단위, 화면은 경로, 대시보드·로그인·관리는 없음", () => {
    expect(targetFor("/regions/1168058000")).toBe("region:1168058000");
    expect(targetFor("/pipeline")).toBe("page:/pipeline");
    expect(targetFor("/")).toBeNull();
    expect(targetFor("/login")).toBeNull();
    expect(targetFor("/admin/users")).toBeNull();
  });

  it("대상 키 → 경로 왕복", () => {
    expect(pathOf("region:1168058000")).toBe("/regions/1168058000");
    expect(pathOf("page:/pipeline")).toBe("/pipeline");
  });

  it("메모 앞뒤 공백 제거·1000자 제한", () => {
    expect(cleanNote("  메모  ")).toBe("메모");
    expect(cleanNote("가".repeat(1200))).toHaveLength(1000);
  });
});

describe("미리보기 저장소", () => {
  it("담당 지정·상태·내 담당·메모 추가 삭제", async () => {
    const s = memoryStore();
    await s.saveItem("region:1", { assignee: "dev", status: "doing" }, "202609");
    await s.saveItem("region:1", { status: "hold" }, "202609");
    expect((await s.item("region:1"))?.assignee).toBe("dev");
    expect((await s.item("region:1"))?.status).toBe("hold");
    expect(await s.mine("dev")).toHaveLength(1);
    await s.saveItem("region:1", { status: "done" }, "202609");
    expect(await s.mine("dev")).toHaveLength(0);

    const n = await s.addNote("region:1", " 현장 확인 ", "202609");
    expect((await s.notes("region:1"))[0].body).toBe("현장 확인");
    await s.deleteNote(n.id);
    expect(await s.notes("region:1")).toHaveLength(0);
  });
});
