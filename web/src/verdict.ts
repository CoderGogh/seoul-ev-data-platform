// 판정 근거: ev03 판정 순서(품질 관문 → 수요 → 공급)를 동 단위로 재구성 (files/sqls/ev03/region_gate.sql·classify.sql)
import type { Region } from "./data";

export type StepState = "pass" | "fail" | "skip";

export interface Check {
  label: string;
  value: string;
  rule: string;
  state: StepState;
  tag?: string; // 상태 표시 문구 (기본 충족·미달)
  gap?: string; // 기준까지 거리
}

export interface Step {
  title: string;
  checks: Check[];
  outcome: string;
}

export interface Verdict {
  steps: Step[];
  summary: string;
}

const int = (n: number) => new Intl.NumberFormat("ko-KR").format(Math.round(n));
const sign = (n: number) => (n >= 0 ? "+" : "−");
const st = (ok: boolean): StepState => (ok ? "pass" : "fail");

// 이상 기준 거리 문구
function gapAbove(value: number, min: number, unit: string, fmt: (n: number) => string = int) {
  const d = value - min;
  return d >= 0 ? `기준보다 ${fmt(d)}${unit} 높음` : `${fmt(-d)}${unit} 부족`;
}

export function verdict(r: Region, p: Record<string, number>): Verdict {
  // 1. 품질 관문 (Gate 2): 치명 → 판단 보류, 기준 미달 → 데이터 부족
  const fatal: Check[] = [
    { label: "등록 데이터", value: r.ev_cnt == null ? "없음" : "있음", rule: "필수", state: st(r.ev_cnt != null) },
  ];
  const below: Check[] = [
    {
      label: "수집 도로",
      value: `${r.link_cnt}개 링크`,
      rule: `${p.min_link_cnt}개 이상 (0개면 보류)`,
      state: st(r.link_cnt >= p.min_link_cnt),
      gap: r.link_cnt >= p.min_link_cnt ? undefined : `${p.min_link_cnt - r.link_cnt}개 부족`,
    },
    {
      label: "관측 커버리지",
      value: `${r.coverage.toFixed(1)}%`,
      rule: `${p.min_coverage}% 이상`,
      state: st(r.coverage >= p.min_coverage),
      gap: r.coverage >= p.min_coverage ? undefined : `${(p.min_coverage - r.coverage).toFixed(1)}%p 부족`,
    },
  ];
  if (r.valid_timebands != null) {
    below.push({
      label: "유효 시간대",
      value: `${r.valid_timebands}개`,
      rule: `${p.min_valid_timebands}개 이상`,
      state: st(r.valid_timebands >= p.min_valid_timebands),
      gap: r.valid_timebands >= p.min_valid_timebands ? undefined : `${p.min_valid_timebands - r.valid_timebands}개 부족`,
    });
  }
  const gate: Step = {
    title: "1. 품질 관문",
    checks: [...fatal, ...below],
    outcome:
      r.quality_grade === "fatal"
        ? "필수 데이터 없음 → 판단 보류"
        : r.quality_grade === "below"
          ? "관측 기준 미달 → 데이터 부족"
          : r.quality_grade === "warn"
            ? "통과 (전년 동월 없음, 증가율 제한)"
            : "통과",
  };
  if (r.quality_grade === "fatal" || r.quality_grade === "below") {
    return { steps: [gate], summary: gate.outcome.split("→ ")[1] + ": 수요·공급 판정 안 함" };
  }

  // 2. 수요: 규모·증가율 모두 기준 이상 (증가율 계산 불가는 미통과)
  const evOk = r.ev_cnt >= p.a_min_ev_cnt;
  const yoyOk = r.ev_yoy_rate != null && r.ev_yoy_rate >= p.a_min_yoy_rate;
  const demand: Step = {
    title: "2. 수요",
    checks: [
      {
        label: "전기차 대수",
        value: `${int(r.ev_cnt)}대`,
        rule: `${int(p.a_min_ev_cnt)}대 이상`,
        state: st(evOk),
        gap: gapAbove(r.ev_cnt, p.a_min_ev_cnt, "대"),
      },
      {
        label: "1년 증가율",
        value: r.ev_yoy_rate == null ? "계산 불가" : `${r.ev_yoy_rate.toFixed(1)}%`,
        rule: `${p.a_min_yoy_rate}% 이상`,
        state: st(yoyOk),
        gap: r.ev_yoy_rate == null ? "전년 동월 없음" : gapAbove(r.ev_yoy_rate, p.a_min_yoy_rate, "%p", (n) => n.toFixed(1)),
      },
    ],
    outcome: evOk && yoyOk ? "충족" : "미충족 → 관찰 대상",
  };
  if (!(evOk && yoyOk)) {
    const miss = demand.checks.filter((c) => c.state === "fail").map((c) => c.label);
    return { steps: [gate, demand], summary: `관찰 대상: ${miss.join("·")} 기준 미달` };
  }

  // 3. 공급: 충전기 1대당 전기차 기준 이상(또는 충전기 없음)이면 부족. 기준 없는 버전은 생략
  if (p.a_min_ev_per_charger == null) {
    return { steps: [gate, demand], summary: "우선 검토: 수요 기준 충족" };
  }
  const per = r.ev_per_charger;
  const supply: Step = {
    title: "3. 공급",
    checks: [
      {
        label: "충전기 1대당 전기차",
        value: r.charger_cnt === 0 ? "충전기 없음" : per == null ? "-" : `${per.toFixed(1)}대`,
        rule: `${p.a_min_ev_per_charger}대 이상이면 부족`,
        state: st(Boolean(r.supply_gap)),
        tag: r.supply_gap ? "부족" : "충분",
        gap:
          per == null
            ? undefined
            : `기준 대비 ${sign(per - p.a_min_ev_per_charger)}${Math.abs(per - p.a_min_ev_per_charger).toFixed(1)}대`,
      },
    ],
    outcome: r.supply_gap ? "부족" : "충분 → 관찰 대상",
  };
  return {
    steps: [gate, demand, supply],
    summary: r.supply_gap ? "우선 검토: 수요 기준 충족, 충전기 공급 부족" : "관찰 대상: 수요는 충족하지만 충전기가 충분",
  };
}
