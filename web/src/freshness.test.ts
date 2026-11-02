// 데이터 신선도 등급 규칙
import { describe, expect, it } from "vitest";
import type { Chargers, Meta } from "./data";
import { daysBetween, expectedRegMonth, freshness, levelByAge, monthGap, summary, worst } from "./freshness";

const at = (iso: string) => new Date(iso);

const meta = {
  base_month: "202609",
  published_at: "2026-11-02T20:24:29+09:00",
  pipeline: [
    { dag_id: "ev03_mart_integration", status: "published", runs: 3, last_finished_at: "2026-11-02T20:24:30+09:00" },
    { dag_id: "ev03_mart_integration", status: "skipped_unchanged", runs: 12, last_finished_at: "2026-11-05T06:00:10+09:00" },
    { dag_id: "ev01_traffic_collect", status: "success", runs: 1, last_finished_at: "2026-11-09T06:00:00+09:00" },
  ],
  poll: { batches: 62, first_at: "2026-10-27T17:31:00+09:00", last_at: "2026-10-28T23:00:05+09:00", ok_ratio: 98.6 },
} as Meta;
const chargers = { snapshot_date: "2026-11-02" } as Chargers;

const byKey = (now: string) => Object.fromEntries(freshness(meta, chargers, at(now)).map((i) => [i.key, i]));

describe("날짜 계산", () => {
  it("KST 달력 날짜 차이 (자정 넘김 포함)", () => {
    expect(daysBetween("2026-11-02T23:59:00+09:00", at("2026-11-03T00:01:00+09:00"))).toBe(1);
    expect(daysBetween("2026-11-02T00:01:00+09:00", at("2026-11-02T23:59:00+09:00"))).toBe(0);
    expect(daysBetween("2026-11-02", at("2026-11-04T09:00:00+09:00"))).toBe(2);
  });

  it("등록 기대 최신 월: 익월 중순 공표", () => {
    expect(expectedRegMonth(at("2026-11-02T12:00:00+09:00"))).toBe("202609"); // 10월분 미공표
    expect(expectedRegMonth(at("2026-11-20T12:00:00+09:00"))).toBe("202610");
    expect(expectedRegMonth(at("2027-01-20T12:00:00+09:00"))).toBe("202612"); // 연 경계
    expect(monthGap("202611", "202702")).toBe(3);
  });

  it("경과 일수 등급 경계", () => {
    expect(levelByAge(2, 2)).toBe("ok");
    expect(levelByAge(3, 2)).toBe("warn");
    expect(levelByAge(7, 2)).toBe("warn");
    expect(levelByAge(8, 2)).toBe("bad");
  });
});

describe("원천별 신선도", () => {
  it("11/02 기준: 게시·등록·충전기 정상, 도로는 수집 멈춤 주의", () => {
    const f = byKey("2026-11-02T21:00:00+09:00");
    expect([f.publish.level, f.registration.level, f.charger.level]).toEqual(["ok", "ok", "ok"]);
    expect(f.road.level).toBe("warn");
    expect(f.road.age).toBe("5일째 멈춤");
  });

  it("시간이 지나면 등급 하락 (등록 2개월 밀림·도로 오래됨)", () => {
    const f = byKey("2026-12-20T12:00:00+09:00");
    expect(f.registration.age).toBe("2개월 밀림");
    expect(f.registration.level).toBe("bad");
    expect(f.road.level).toBe("bad");
    expect(worst(Object.values(f))).toBe("bad");
  });

  it("게시: 재게시 없어도 마지막 재평가(변경 없음 생략) 기준, 다른 DAG 실행은 무시", () => {
    const f = byKey("2026-11-06T09:00:00+09:00");
    expect(f.publish.value).toBe("11. 2.");
    expect([f.publish.age, f.publish.level]).toEqual(["확인 1일 전", "ok"]);
    expect(byKey("2026-11-09T09:00:00+09:00").publish.level).toBe("warn");
  });

  it("충전기 데이터 없으면 항목 생략, 모두 정상이면 경고 문구 없음", () => {
    const fresh = { ...meta, poll: { ...meta.poll, last_at: "2026-11-02T20:30:00+09:00" } };
    const items = freshness(fresh, null, at("2026-11-02T21:00:00+09:00"));
    expect(items.map((i) => i.key)).toEqual(["publish", "registration", "road"]);
    expect(summary(items)).toBeNull();
    expect(items.find((i) => i.key === "road")?.age).toBe("수집 중");
  });

  it("경고 문구에 오래된 원천과 기준일", () => {
    const msg = summary(freshness(meta, chargers, at("2026-11-02T21:00:00+09:00")));
    expect(msg).toContain("도로 10. 28. (5일째 멈춤)");
  });
});
