// 지도 공급 단계·충전소 점 필터
import { describe, expect, it } from "vitest";
import { supplyStep } from "./components/RegionMap";
import { stationPoints } from "./pages/MapPage";

describe("supplyStep", () => {
  it("기준 미만 0, 1·2배 구간, 3배 이상 3, 미산출 null", () => {
    expect([1.8, 2.1, 4.3, 6.4, 20].map((v) => supplyStep(v, 2.1))).toEqual([0, 1, 2, 3, 3]);
    expect(supplyStep(null, 2.1)).toBeNull();
  });
});

describe("stationPoints", () => {
  const st: [number, number, number, number][] = [
    [127.0, 37.5, 4, 1],
    [127.1, 37.4, 6, 0],
  ];
  it("필터별 점", () => {
    expect(stationPoints(st, "off")).toEqual([]);
    expect(stationPoints(st, "all")).toHaveLength(2);
    expect(stationPoints(st, "fast")).toEqual([{ lng: 127.0, lat: 37.5, fast: true }]);
    expect(stationPoints(st, "slow")).toEqual([{ lng: 127.1, lat: 37.4, fast: false }]);
    expect(stationPoints(undefined, "all")).toEqual([]);
  });
});
