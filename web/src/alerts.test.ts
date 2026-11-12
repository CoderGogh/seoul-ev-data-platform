// 화면별 알림: 게시 변화·이상 증가·운영 알림 노출 범위
import { describe, expect, it } from "vitest";
import type { AppData, Region } from "./data";
import { pageAlerts } from "./alerts";

const region = (o: Partial<Region>) =>
  ({ adm_cd: "1", adm_nm: "가동", sgg_nm: "강남구", classification: "REF", quality_grade: "ok", reason_codes: [], ev_cnt: 100, ev_yoy_rate: 10, ...o }) as Region;

const now = new Date("2026-11-12T12:00:00+09:00");
const data = {
  regions: [
    region({ adm_cd: "1111", adm_nm: "가동", classification: "A", growth_flags: ["concentrated"] }),
    region({ adm_cd: "2222", adm_nm: "나동", classification: "A" }),
    region({ adm_cd: "1234567890", adm_nm: "다동", ev_cnt: 600, ev_yoy_rate: 35 }),
  ],
  meta: {
    base_month: "202609",
    published_at: "2026-11-12T06:00:00+09:00",
    threshold: { params: { a_min_ev_cnt: 522, a_min_yoy_rate: 39.7 } },
    pipeline: [
      { dag_id: "ev11_reprocess", status: "failed", runs: 1, last_finished_at: "2026-11-10T10:00:00+09:00" },
      { dag_id: "ev01_traffic_collect", status: "partial", runs: 70, last_finished_at: "2026-10-28T23:00:00+09:00" },
    ],
    poll: { last_at: "2026-11-12T11:30:00+09:00" },
  },
  chargers: null,
  history: {
    publishes: [
      { base_month: "202609", run_id: "a", published_at: "2026-11-02T20:00:00+09:00", a_list: ["2222", "1234567890"] },
      { base_month: "202609", run_id: "b", published_at: "2026-11-03T06:00:00+09:00", a_list: ["1111", "2222"] },
    ],
    reprocess: [{ request_id: 1, status: "requested" }],
  },
} as unknown as AppData;

const texts = (path: string, op = false) => pageAlerts(path, data, op, now).map((a) => a.text);

describe("pageAlerts", () => {
  it("목록 화면: 최근 게시 추가·제외, 이상 증가 우선 검토", () => {
    const t = texts("/priority");
    expect(t[0]).toContain("추가 가동");
    expect(t[0]).toContain("제외 다동");
    expect(t[1]).toContain("이상 증가 표시: 가동");
  });

  it("동 상세: 해당 동 변화·근접 기준", () => {
    expect(texts("/regions/1234567890")).toEqual([expect.stringContaining("우선 검토에서 빠짐"), expect.stringContaining("기준 근접")]);
  });

  it("운영 알림은 운영 이상만, 최근 7일 실패만", () => {
    expect(texts("/pipeline", false)).toEqual([]);
    const t = texts("/pipeline", true);
    expect(t.some((x) => x.includes("재처리 실패"))).toBe(true);
    expect(t.some((x) => x.includes("도로 수집"))).toBe(false); // 10/28 일부 수집은 오래됨
  });

  it("게시 이력: 대기 중 재처리", () => {
    expect(texts("/history")[0]).toContain("재처리 요청 1건");
  });

  it("알림 없는 화면은 빈 목록", () => {
    expect(texts("/progress")).toEqual([]);
  });
});
