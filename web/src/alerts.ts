// 오른쪽 바 화면별 알림 (게시 데이터에서 계산, 운영 알림은 운영 이상에게만)
import { DAG_LABEL, FLAG_LABEL, STATUS_LABEL, fmtDate, fmtMonth, type AppData, type Region } from "./data";
import { freshness } from "./freshness";
import { publishDiffs } from "./history";
import { nearMiss } from "./insights";

export type AlertTone = "info" | "ok" | "warn" | "bad";

export interface PageAlert {
  tone: AlertTone;
  text: string;
  to?: string;
}

const DAY = 86_400_000;
const RECENT_DAYS = 7;

// 동 이름 나열 (최대 3곳)
function names(regions: Region[]): string {
  const head = regions.slice(0, 3).map((r) => r.adm_nm);
  return regions.length > 3 ? `${head.join(", ")} 외 ${regions.length - 3}곳` : head.join(", ");
}

// 최근 게시의 우선 검토 변화
function publishChange(data: AppData): PageAlert | null {
  const latest = publishDiffs(data.history?.publishes ?? [])[0];
  if (!latest) return null;
  const when = fmtDate(latest.entry.published_at);
  if (!latest.comparable) return { tone: "info", text: `최근 게시 ${when} (${fmtMonth(latest.entry.base_month)} 기준)`, to: "/history" };
  const byCd = new Map(data.regions.map((r) => [r.adm_cd, r.adm_nm]));
  const label = (cds: string[]) => cds.map((c) => byCd.get(c) ?? c).join(", ");
  if (latest.added.length + latest.removed.length === 0)
    return { tone: "ok", text: `최근 게시 ${when}: 우선 검토 변화 없음`, to: "/history" };
  const parts = [
    latest.added.length ? `추가 ${label(latest.added)}` : "",
    latest.removed.length ? `제외 ${label(latest.removed)}` : "",
  ].filter(Boolean);
  return { tone: "warn", text: `최근 게시 ${when}: 우선 검토 ${parts.join(" · ")}`, to: "/history" };
}

// 우선 검토 중 이상 증가 표시 동
function flaggedPriority(data: AppData): PageAlert | null {
  const flagged = data.regions.filter((r) => r.classification === "A" && r.growth_flags?.length);
  if (!flagged.length) return null;
  return { tone: "warn", text: `우선 검토 ${flagged.length}곳 이상 증가 표시: ${names(flagged)}`, to: "/trend" };
}

// 원천 기준일 주의·오래됨
function staleSources(data: AppData, now: Date): PageAlert[] {
  return freshness(data.meta, data.chargers, now)
    .filter((i) => i.level !== "ok")
    .map((i) => ({ tone: i.level === "bad" ? "bad" : "warn", text: `${i.label} ${i.value} (${i.age})`, to: "/versions" }));
}

// 최근 실패·보류 DAG
function pipelineIssues(data: AppData, now: Date): PageAlert[] {
  return data.meta.pipeline
    .filter((p) => ["failed", "held", "partial"].includes(p.status))
    .filter((p) => p.last_finished_at && now.getTime() - new Date(p.last_finished_at).getTime() <= RECENT_DAYS * DAY)
    .map((p) => ({
      tone: p.status === "failed" ? "bad" : "warn",
      text: `${DAG_LABEL[p.dag_id] ?? p.dag_id} ${STATUS_LABEL[p.status] ?? p.status} ${p.runs}회 (최근 ${fmtDate(p.last_finished_at!)})`,
      to: "/pipeline",
    }));
}

// 대기·진행 중 재처리 요청
function openReprocess(data: AppData): PageAlert | null {
  const open = (data.history?.reprocess ?? []).filter((r) => r.status === "requested" || r.status === "running");
  if (!open.length) return null;
  return { tone: "info", text: `재처리 요청 ${open.length}건 처리 대기·진행 중`, to: "/history" };
}

// 충전기 수집 관문 미통과·좌표 오류
function chargerIssues(data: AppData): PageAlert[] {
  const c = data.chargers;
  if (!c) return [];
  const out: PageAlert[] = c.quality
    .filter((q) => q.grade !== "ok")
    .map((q) => ({ tone: "warn", text: `충전기 수집 관문 ${q.check}${q.scope !== "*" ? ` (${q.scope})` : ""} ${q.grade}`, to: "/supply" }));
  const mismatch = c.status.sgg_mismatch ?? 0;
  if (mismatch) out.push({ tone: "info", text: `다른 구 좌표 충전기 ${mismatch}건 집계 제외`, to: "/supply" });
  return out;
}

// 동 상세 알림
function regionAlerts(data: AppData, cd: string): PageAlert[] {
  const r = data.regions.find((x) => x.adm_cd === cd);
  if (!r) return [];
  const out: PageAlert[] = [];
  const latest = publishDiffs(data.history?.publishes ?? [])[0];
  if (latest?.added.includes(cd)) out.push({ tone: "warn", text: `최근 게시 ${fmtDate(latest.entry.published_at)}에 우선 검토로 새로 들어옴`, to: "/history" });
  if (latest?.removed.includes(cd)) out.push({ tone: "warn", text: `최근 게시 ${fmtDate(latest.entry.published_at)}에 우선 검토에서 빠짐`, to: "/history" });
  r.growth_flags?.forEach((f) => out.push({ tone: "warn", text: `이상 증가 표시: ${FLAG_LABEL[f] ?? f}. 법인·대량 등록 여부 확인` }));
  if (r.reason_codes.includes("supply_sufficient")) out.push({ tone: "info", text: "수요 기준은 넘었지만 충전기가 충분해 우선 검토 제외" });
  if (r.quality_grade !== "ok") out.push({ tone: "warn", text: `데이터 품질 등급 ${r.quality_grade}. 판정 근거 확인`, to: "/quality" });
  const p = data.meta.threshold.params;
  const near = nearMiss([r], p.a_min_ev_cnt, p.a_min_yoy_rate)[0];
  if (near) out.push({ tone: "info", text: `기준 근접: ${near.short}`, to: "/criteria" });
  return out;
}

// 화면별 알림 목록
export function pageAlerts(path: string, data: AppData, operator: boolean, now = new Date()): PageAlert[] {
  const ops = operator ? [...staleSources(data, now), ...pipelineIssues(data, now)] : [];
  const keep = (xs: (PageAlert | null)[]) => xs.filter((x): x is PageAlert => x != null);

  const detail = path.match(/^\/regions\/(\d{10})$/);
  if (detail) return regionAlerts(data, detail[1]);

  switch (path) {
    case "/":
      return keep([publishChange(data), flaggedPriority(data), ...(operator ? ops.slice(0, 3) : [])]);
    case "/priority":
    case "/map":
    case "/regions":
    case "/compare":
      return keep([publishChange(data), flaggedPriority(data)]);
    case "/criteria": {
      const p = data.meta.threshold.params;
      const near = nearMiss(data.regions, p.a_min_ev_cnt, p.a_min_yoy_rate);
      return keep([
        near.length ? { tone: "info", text: `기준 근접 ${near.length}곳: ${names(near.map((n) => n.region))}` } : null,
        publishChange(data),
      ]);
    }
    case "/trend": {
      const flagged = data.regions.filter((r) => r.growth_flags?.length);
      return keep([flagged.length ? { tone: "warn", text: `이상 증가 표시 ${flagged.length}곳: ${names(flagged)}` } : null]);
    }
    case "/road": {
      const slow = data.regions.filter((r) => r.classification === "A" && r.charger_hint === "slow");
      return keep([
        slow.length ? { tone: "info", text: `우선 검토 중 도로 혼잡 ${slow.length}곳: ${names(slow)}. 진입·대기 동선 확인` } : null,
      ]);
    }
    case "/supply":
      return [...(data.chargers ? [{ tone: "info" as const, text: `충전기 ${fmtDate(data.chargers.snapshot_date)} 수집 기준` }] : []), ...chargerIssues(data)];
    case "/quality":
    case "/versions": {
      const bad = data.regions.filter((r) => r.quality_grade !== "ok");
      return keep([
        ...staleSources(data, now),
        bad.length ? { tone: "warn", text: `품질 등급 미달 ${bad.length}곳: ${names(bad)}` } : null,
        ...chargerIssues(data),
      ]);
    }
    case "/pipeline":
      return ops;
    case "/history":
      return keep([openReprocess(data), publishChange(data)]);
    default:
      return [];
  }
}
