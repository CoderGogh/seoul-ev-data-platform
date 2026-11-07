// 데이터 로더: 데이터 브랜치 우선(커밋 고정 주소), 실패·불일치면 배포 스냅샷
import { describe, expect, it } from "vitest";
import { REMOTE, loadData } from "./data";

const SHA = "a".repeat(40);
const files = (regionCnt: number, regions = 2) => ({
  regions: Array.from({ length: regions }, (_, i) => ({ adm_cd: String(i) })),
  monthly: {},
  timeband: {},
  admdong: { type: "FeatureCollection", features: [] },
  meta: { region_cnt: regionCnt },
  chargers: { by_dong: [] },
  history: { publishes: [], reprocess: [] },
});

// 가짜 fetch: 주소별 응답, 요청 기록
function fakeFetch(opts: { branch?: number; remote?: ReturnType<typeof files>; local: ReturnType<typeof files> }) {
  const calls: string[] = [];
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
  const fail = (status: number) => ({ ok: false, status, json: async () => ({}) }) as Response;
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://api.github.com/")) {
      return opts.branch && opts.branch !== 200
        ? fail(opts.branch)
        : ok({ commit: { sha: SHA, commit: { committer: { date: "2026-11-03T07:10:00Z" } } } });
    }
    const name = url.split("/").pop()!.replace(".json", "") as keyof ReturnType<typeof files>;
    const src = url.startsWith("https://raw.githubusercontent.com/") ? opts.remote : opts.local;
    return src && name in src ? ok(src[name]) : fail(404); // 없는 파일은 404 (raw CDN 과 같게)
  }) as typeof fetch;
  return { f, calls };
}

describe("loadData", () => {
  it("데이터 브랜치 성공: 커밋 SHA 고정 주소에서 로드", async () => {
    const { f, calls } = fakeFetch({ remote: files(2), local: files(2) });
    const d = await loadData(f);
    expect(d.source).toMatchObject({ kind: "remote", sha: SHA });
    const raw = calls.filter((u) => u.startsWith("https://raw.githubusercontent.com/"));
    expect(raw).toHaveLength(7);
    expect(raw.every((u) => u.startsWith(`https://raw.githubusercontent.com/${REMOTE.repo}/${SHA}/web/`))).toBe(true);
    expect(calls.some((u) => u.startsWith("/data/"))).toBe(false);
  });

  it("브랜치 없음(404): 배포 스냅샷", async () => {
    const { f } = fakeFetch({ branch: 404, local: files(2) });
    const d = await loadData(f);
    expect(d.source.kind).toBe("bundle");
    expect(d.source.reason).toContain("404");
  });

  it("원격 내용 불일치(행정동 수): 배포 스냅샷", async () => {
    const { f } = fakeFetch({ remote: files(67, 2), local: files(2) });
    const d = await loadData(f);
    expect(d.source).toMatchObject({ kind: "bundle", reason: "행정동 수 불일치" });
    expect(d.regions).toHaveLength(2);
  });

  it("원격 파일 하나라도 없으면 섞지 않고 전부 배포 스냅샷", async () => {
    const remote = files(2) as Record<string, unknown>;
    delete remote.chargers;
    const { f, calls } = fakeFetch({ remote: remote as ReturnType<typeof files>, local: files(2) });
    const d = await loadData(f);
    expect(d.source.kind).toBe("bundle");
    expect(calls.filter((u) => u.startsWith("/data/"))).toHaveLength(7);
  });

  it("게시 이력은 선택: 원격에 없어도 원격 사용, history null", async () => {
    const remote = files(2) as Record<string, unknown>;
    delete remote.history;
    const { f } = fakeFetch({ remote: remote as ReturnType<typeof files>, local: files(2) });
    const d = await loadData(f);
    expect(d.source.kind).toBe("remote");
    expect(d.history).toBeNull();
  });
});
