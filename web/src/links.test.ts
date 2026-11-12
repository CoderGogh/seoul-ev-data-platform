// 링크 타일: 경계 판정·자치구 묶음·미게시 동 제외
import { describe, expect, it } from "vitest";
import type { Links, Region } from "./data";
import { linkHint, linkTiles } from "./insights";

const region = (adm_cd: string, adm_nm: string, sgg_nm: string) => ({ adm_cd, adm_nm, sgg_nm }) as Region;

describe("linkHint", () => {
  it("13% 미만 원활, 22% 이상 혼잡, 관측 없음 null", () => {
    expect([0, 12.9, 13, 21.9, 22, null].map((v) => linkHint(v, 13, 22))).toEqual([
      "fast", "fast", "mixed", "mixed", "slow", null,
    ]);
  });
});

describe("linkTiles", () => {
  it("자치구 가나다순, 동 안에서 저속 비중 순, 미게시 동 제외", () => {
    const links: Links = {
      base_month: "202609",
      window: { start: "", end: "" },
      links: [
        ["l1", "2", 30, 9],
        ["l2", "1", 5, 9],
        ["l3", "1", null, 0],
        ["l4", "9", 0, 9],
      ],
    };
    const g = linkTiles(links, [region("1", "역삼1동", "강남구"), region("2", "반포1동", "서초구")], 13, 22);
    expect(g.map((x) => x.sgg)).toEqual(["강남구", "서초구"]);
    expect(g[0].tiles.map((t) => t.id)).toEqual(["l3", "l2"]);
    expect(g[0].counts).toEqual({ fast: 1, mixed: 0, slow: 0, none: 1 });
    expect(g[1].tiles[0].hint).toBe("slow");
  });
});
