// 게시 이력 A 변화·CSV
import { describe, expect, it } from "vitest";
import type { PublishEntry, Region } from "./data";
import { publishDiffs } from "./history";
import { toCsv } from "./csv";

const pub = (run: string, at: string, a: string[] | null): PublishEntry => ({
  base_month: "202609", run_id: run, published_at: at, threshold_ver: "mvp_v3", region_cnt: 67,
  request_id: null, a_list: a, class_dist: null,
});

describe("publishDiffs", () => {
  it("최신순, 직전 대비 추가·제외, 기록 없는 게시는 비교 불가", () => {
    const d = publishDiffs([
      pub("r2", "2026-11-02T06:00:00Z", ["1", "2"]),
      pub("r1", "2026-10-28T06:00:00Z", null),
      pub("r3", "2026-11-09T06:00:00Z", ["2", "3"]),
    ]);
    expect(d.map((x) => x.entry.run_id)).toEqual(["r3", "r2", "r1"]);
    expect(d[0]).toMatchObject({ comparable: true, added: ["3"], removed: ["1"] });
    expect(d[1].comparable).toBe(false);
    expect(d[2].comparable).toBe(false);
  });
});

describe("toCsv", () => {
  it("BOM·머리글·이스케이프", () => {
    const r = {
      adm_cd: "1168058000", sgg_nm: "강남구", adm_nm: "삼성1동", classification: "A", quality_grade: "ok",
      ev_cnt: 1276, reason_codes: ["a", "b"], growth_pattern: '꾸준한, "증가"', supply_gap: true,
    } as unknown as Region;
    const lines = toCsv([r]).split("\r\n");
    expect(lines[0].startsWith("﻿행정동 코드,자치구")).toBe(true);
    expect(lines[1]).toContain('"꾸준한, ""증가"""');
    expect(lines[1]).toContain("우선 검토");
    expect(lines[1].split(",")[12]).toBe("Y");
  });
});
