// 판정 근거: 분류 결과와 같은 단계에서 멈추는지, 기준 거리 문구
import { describe, expect, it } from "vitest";
import type { Region } from "./data";
import { verdict } from "./verdict";

const P = {
  a_min_ev_cnt: 522, a_min_yoy_rate: 39.7, a_min_ev_per_charger: 2.1,
  min_link_cnt: 3, min_coverage: 60, min_valid_timebands: 6,
};
const base = {
  adm_cd: "1", sgg_nm: "강남구", adm_nm: "가동", classification: "A", quality_grade: "ok", reason_codes: [],
  ev_cnt: 1276, prev_ev_cnt: 726, ev_yoy_rate: 75.76, link_cnt: 22, coverage: 100, valid_timebands: 15,
  charger_cnt: 246, ev_per_charger: 5.19, supply_gap: true,
} as unknown as Region;
const r = (o: Partial<Region>) => ({ ...base, ...o }) as Region;

describe("verdict", () => {
  it("우선 검토: 3단계 전부, 기준 거리", () => {
    const v = verdict(base, P);
    expect(v.steps.map((s) => s.title)).toEqual(["1. 품질 관문", "2. 수요", "3. 공급"]);
    expect(v.steps[1].checks[0].gap).toBe("기준보다 754대 높음");
    expect(v.steps[2].checks[0].gap).toBe("기준 대비 +3.1대");
    expect(v.summary).toContain("우선 검토");
  });

  it("공급 충분: 관찰 대상", () => {
    const v = verdict(r({ classification: "REF", ev_per_charger: 1.8, supply_gap: false }), P);
    expect(v.steps[2].outcome).toContain("충분");
    expect(v.steps[2].checks[0].gap).toBe("기준 대비 −0.3대");
  });

  it("수요 미달: 공급 단계 없음, 미달 항목", () => {
    const v = verdict(r({ ev_cnt: 100, ev_yoy_rate: null }), P);
    expect(v.steps).toHaveLength(2);
    expect(v.steps[1].checks[0].gap).toBe("422대 부족");
    expect(v.summary).toBe("관찰 대상: 전기차 대수·1년 증가율 기준 미달");
  });

  it("관측 미달·필수 없음: 관문에서 멈춤", () => {
    const below = verdict(r({ quality_grade: "below", coverage: 40, valid_timebands: 2 }), P);
    expect(below.steps).toHaveLength(1);
    expect(below.steps[0].checks.filter((c) => c.state === "fail").map((c) => c.gap)).toEqual(["20.0%p 부족", "4개 부족"]);
    expect(below.summary).toBe("데이터 부족: 수요·공급 판정 안 함");
    expect(verdict(r({ quality_grade: "fatal", link_cnt: 0 }), P).summary).toBe("판단 보류: 수요·공급 판정 안 함");
  });

  it("공급 기준 없는 버전: 수요만", () => {
    const { a_min_ev_per_charger: _, ...v2 } = P;
    expect(verdict(base, v2).steps).toHaveLength(2);
  });
});
