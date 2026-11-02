// 데이터 신선도: 원천별 기준일·경과 일수·등급 (화면 시각 기준)
import type { Chargers, Meta } from "./data";

export type Level = "ok" | "warn" | "bad";

export interface FreshItem {
  key: "publish" | "registration" | "road" | "charger";
  label: string;
  value: string; // 기준일 표시
  age: string; // 경과 표시
  level: Level;
  rule: string; // 등급 기준 설명
}

const DAY = 86_400_000;
const KST = "Asia/Seoul";

// KST 달력 날짜 차이 (시각 무시)
export function daysBetween(fromIso: string, now: Date): number {
  const d = (x: Date) => new Date(x.toLocaleDateString("en-CA", { timeZone: KST })).getTime();
  return Math.round((d(now) - d(new Date(fromIso))) / DAY);
}

// 경과 일수 → 등급 (기준 이하 정상, 7일 이하 주의, 그 이상 오래됨)
export function levelByAge(days: number, okDays: number, warnDays = 7): Level {
  if (days <= okDays) return "ok";
  return days <= warnDays ? "warn" : "bad";
}

const ageText = (days: number) => (days <= 0 ? "오늘" : `${days}일 전`);

const md = (iso: string) =>
  new Date(iso).toLocaleDateString("ko-KR", { timeZone: KST, month: "numeric", day: "numeric" });

// 등록현황 기대 최신 월: 익월 중순 공표 → (오늘 - 15일)의 전월
export function expectedRegMonth(now: Date): string {
  const t = new Date(now.getTime() - 15 * DAY);
  const [y, m] = t.toLocaleDateString("en-CA", { timeZone: KST }).split("-").map(Number);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${prev.y}${String(prev.m).padStart(2, "0")}`;
}

export const monthGap = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(4)) - Number(a.slice(4));

export function freshness(meta: Meta, chargers: Chargers | null, now = new Date()): FreshItem[] {
  const items: FreshItem[] = [];

  // 게시: ev03 매일 06:00 재평가 (입력 같으면 재게시 생략) → 마지막 재평가 기준 2일까지 정상
  const evals = meta.pipeline
    .filter((p) => p.dag_id === "ev03_mart_integration" && p.last_finished_at)
    .map((p) => p.last_finished_at as string)
    .sort();
  const lastEval = evals.length ? evals[evals.length - 1] : meta.published_at;
  const evalDays = daysBetween(lastEval, now);
  items.push({
    key: "publish",
    label: "게시",
    value: md(meta.published_at),
    age: `확인 ${ageText(evalDays)}`,
    level: levelByAge(evalDays, 2),
    rule: `매일 06:00 재평가, 입력이 같으면 이전 게시 유지. 마지막 재평가 ${md(lastEval)}, 2일 이내 정상`,
  });

  // 등록: 기대 최신 월 대비 밀린 개월 수
  const expected = expectedRegMonth(now);
  const lag = Math.max(0, monthGap(meta.base_month, expected));
  items.push({
    key: "registration",
    label: "등록",
    value: `${meta.base_month.slice(0, 4)}.${meta.base_month.slice(4)}`,
    age: lag === 0 ? "최신" : `${lag}개월 밀림`,
    level: lag === 0 ? "ok" : lag === 1 ? "warn" : "bad",
    rule: "익월 중순 공표. 공표된 최신 월이면 정상, 1개월 밀리면 주의",
  });

  // 도로: 30분 수집 → 1일까지 정상
  const roadDays = daysBetween(meta.poll.last_at, now);
  items.push({
    key: "road",
    label: "도로",
    value: md(meta.poll.last_at),
    age: roadDays <= 0 ? "수집 중" : `${roadDays}일째 멈춤`,
    level: levelByAge(roadDays, 1),
    rule: "30분마다 수집. 마지막 수집이 1일 이내면 정상",
  });

  // 충전기: 매일 05:00 수집 → 2일까지 정상
  if (chargers) {
    const chDays = daysBetween(chargers.snapshot_date, now);
    items.push({
      key: "charger",
      label: "충전기",
      value: md(chargers.snapshot_date),
      age: ageText(chDays),
      level: levelByAge(chDays, 2),
      rule: "매일 05:00 수집. 2일 이내 정상",
    });
  }
  return items;
}

export const worst = (items: FreshItem[]): Level =>
  items.some((i) => i.level === "bad") ? "bad" : items.some((i) => i.level === "warn") ? "warn" : "ok";

// 경고 문구 (가장 오래된 원천 기준)
export function summary(items: FreshItem[]): string | null {
  const stale = items.filter((i) => i.level !== "ok");
  if (stale.length === 0) return null;
  const parts = stale.map((i) => `${i.label} ${i.value} (${i.age})`);
  return `오래된 데이터가 있습니다: ${parts.join(", ")}. 결과는 각 기준일 시점입니다.`;
}
