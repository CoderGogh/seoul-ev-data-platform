// 배경지도 좌표·타일 계산
import { describe, expect, it } from "vitest";
import { MAX_Z, MIN_Z, mercX, mercY, pickZoom, tileUrl, tilesFor } from "./basemap";

describe("웹 메르카토르", () => {
  it("경도 0·위도 0은 중앙, 서울은 z13 타일 (6985, 3172) 안", () => {
    expect(mercX(0)).toBe(0.5);
    expect(mercY(0)).toBeCloseTo(0.5, 12);
    const n = 2 ** 13;
    expect([Math.floor(mercX(127.0276) * n), Math.floor(mercY(37.4979) * n)]).toEqual([6986, 3174]);
  });
});

describe("pickZoom", () => {
  it("화면 폭을 채우는 최소 줌, 범위 제한", () => {
    const w = mercX(127.2) - mercX(126.95);
    const z = pickZoom(w, 1280);
    expect(w * 256 * 2 ** z).toBeGreaterThanOrEqual(1280);
    expect(w * 256 * 2 ** (z - 1)).toBeLessThan(1280);
    expect(pickZoom(1, 10)).toBe(MIN_Z);
    expect(pickZoom(1e-9, 1e6)).toBe(MAX_Z);
  });
});

describe("tilesFor", () => {
  it("범위를 빈틈없이 덮는 타일", () => {
    const box: [number, number, number, number] = [0.1, 0.2, 0.36, 0.41];
    const t = tilesFor(box, 2); // 한 변 0.25
    expect(t.map((x) => `${x.x},${x.y}`).sort()).toEqual(["0,0", "0,1", "1,0", "1,1"]);
    expect(t[0].size).toBe(0.25);
  });
  it("WMTS 주소는 줌/행(y)/열(x)", () => {
    expect(tileUrl({ z: 13, x: 6986, y: 3174, wx: 0, wy: 0, size: 0 }, "white", "K")).toBe(
      "https://api.vworld.kr/req/wmts/1.0.0/K/white/13/3174/6986.png",
    );
  });
});
