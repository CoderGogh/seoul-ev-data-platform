import { describe, expect, it } from "vitest";
import type { AppData } from "./data";
import { stampFor } from "./versions";

const data = {
  meta: {
    threshold: { ver: "mvp_v3" },
    base_month: "202609",
    traffic_window_start: "2026-10-27T08:30:00Z",
    traffic_window_end: "2026-10-28T03:00:00Z",
    published_at: "2026-11-03T05:00:00Z",
  },
  chargers: { snapshot_date: "2026-11-02" },
} as unknown as AppData;

describe("stampFor", () => {
  it("대시보드는 분류·등록·도로·게시", () => {
    expect(stampFor("/", data)).toEqual(["mvp_v3", "등록 2026.09", "도로 10.27~10.28", "게시 11.03"]);
  });
  it("필요한 기준만 표시", () => {
    expect(stampFor("/trend", data)).toEqual(["등록 2026.09"]);
    expect(stampFor("/supply", data)).toEqual(["충전기 11.02"]);
  });
  it("검토 카드는 행정동 목록 기준", () => {
    expect(stampFor("/regions/1168058000", data)).toEqual(stampFor("/regions", data));
  });
  it("운영 화면·로그인은 표시 안 함", () => {
    for (const p of ["/quality", "/pipeline", "/versions", "/login"]) expect(stampFor(p, data)).toEqual([]);
  });
});
