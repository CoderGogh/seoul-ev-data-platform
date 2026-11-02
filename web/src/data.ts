// 정적 데이터 타입·로더 (scripts/export_web_data.sh 산출물)
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

export type Classification = "A" | "B" | "C" | "REF" | "WITHHELD";
export type ChargerHint = "fast" | "mixed" | "slow";

export interface Region {
  adm_cd: string;
  sgg_nm: string;
  adm_nm: string;
  classification: Classification;
  quality_grade: "ok" | "warn" | "below" | "fatal";
  reason_codes: string[];
  ev_cnt: number;
  prev_ev_cnt: number | null;
  ev_yoy_rate: number | null;
  ev_yoy_abs: number | null;
  is_new_entry: boolean;
  ev_share: number;
  link_cnt: number;
  road_len_km: number;
  coverage: number;
  avg_spd: number;
  speed_cv: number;
  low_spd_ratio: number;
  charger_hint: ChargerHint | null;
  charger_hint_nm: string | null;
  growth_pattern: string | null;
  inc_12m: number | null;
  rate_3m: number | null;
  up_months: number | null;
  charger_asof: string | null;
  charger_cnt: number | null;
  fast_cnt: number | null;
  open_cnt: number | null;
  ev_per_charger: number | null;
  supply_gap: boolean | null;
}

export interface MonthlyPoint {
  base_month: string;
  ev_cnt: number;
}

export interface TimebandPoint {
  timeband: number;
  label: string;
  avg_spd: number;
  link_cnt: number;
}

export interface AdmdongProps {
  adm_cd: string;
  adm_nm: string;
  sgg_nm: string;
  is_target: boolean;
}

export type AdmdongGeo = FeatureCollection<Polygon | MultiPolygon, AdmdongProps>;

export interface PipelineRow {
  dag_id: string;
  status: string;
  runs: number;
  last_finished_at: string | null;
}

export interface Meta {
  base_month: string;
  publish_status: string;
  published_at: string;
  traffic_window_start: string;
  traffic_window_end: string;
  period_mismatch: boolean;
  link_ver: string;
  boundary_ver: string;
  region_cnt: number;
  threshold: { ver: string; basis: string; params: Record<string, number> };
  reg_months: string[];
  pipeline: PipelineRow[];
  poll: { batches: number; first_at: string; last_at: string; ok_ratio: number };
  exported_at: string;
}

// 충전기 공급 (ev04 최신 상태, chargers.json)
export interface ChargerDong {
  adm_cd: string;
  adm_nm: string;
  sgg_nm: string;
  classification: Classification;
  ev_cnt: number | null;
  chargers: number;
  stations: number;
  fast: number;
  open_cnt: number;
  ev_per_charger: number | null;
  ev_per_fast: number | null;
}

export interface ChargerSgg {
  sgg_nm: string;
  chargers: number;
  stations: number;
  fast: number;
  open_cnt: number;
  ev_cnt: number;
}

export interface QualityCheck {
  check: string;
  scope: string;
  grade: string;
  metric: number | null;
  threshold: number | null;
}

export interface Chargers {
  snapshot_date: string;
  loaded_at: string;
  source: string;
  load: { row_cnt: number; new_cnt: number; changed_cnt: number; closed_cnt: number; quality_grade: string };
  status: Record<string, number>;
  quality: QualityCheck[];
  by_sgg: ChargerSgg[];
  by_dong: ChargerDong[];
}

// 개발 진행 (progress.json, scripts/export_progress.py)
export interface ProgressIssue {
  title: string;
  state: "OPEN" | "CLOSED";
  closed_at: string | null;
  url: string;
  labels: string[];
}

export interface Progress {
  repo: string;
  roadmap: { number: number; title: string; url: string };
  stages: { title: string; issues: number[] }[];
  issues: Record<string, ProgressIssue>;
  merged: { number: number; title: string; merged_at: string; url: string; closes: number[] }[];
}

export interface AppData {
  chargers: Chargers | null;
  regions: Region[];
  monthly: Record<string, MonthlyPoint[]>;
  timeband: Record<string, TimebandPoint[]>;
  geo: AdmdongGeo;
  meta: Meta;
}

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`/data/${name}.json`);
  if (!res.ok) throw new Error(`${name}.json 로드 실패 (${res.status})`);
  return res.json() as Promise<T>;
}

// 전체 데이터 일괄 로드 (합계 약 390KB). 충전기는 없어도 나머지 화면 표시
export async function loadData(): Promise<AppData> {
  const [regions, monthly, timeband, geo, meta, chargers] = await Promise.all([
    fetchJson<Region[]>("regions"),
    fetchJson<Record<string, MonthlyPoint[]>>("monthly"),
    fetchJson<Record<string, TimebandPoint[]>>("timeband"),
    fetchJson<AdmdongGeo>("admdong"),
    fetchJson<Meta>("meta"),
    fetchJson<Chargers>("chargers").catch(() => null),
  ]);
  return { regions, monthly, timeband, geo, meta, chargers };
}

export const loadProgress = () => fetchJson<Progress>("progress");

// GitHub 공개 API 최신 이슈 상태 (실패 시 스냅샷 유지)
export async function fetchLiveIssues(repo: string): Promise<Record<string, ProgressIssue> | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=all&per_page=100`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const rows: { number: number; title: string; state: string; closed_at: string | null; html_url: string;
      labels: { name: string }[]; pull_request?: unknown }[] = await res.json();
    return Object.fromEntries(
      rows
        .filter((r) => !r.pull_request)
        .map((r) => [
          String(r.number),
          { title: r.title, state: r.state === "closed" ? "CLOSED" : "OPEN", closed_at: r.closed_at, url: r.html_url,
            labels: r.labels.map((l) => l.name) },
        ]),
    );
  } catch {
    return null;
  }
}

// 표시 문구
export const CLASS_LABEL: Record<Classification, string> = {
  A: "우선 검토",
  B: "관찰",
  C: "데이터 보완 필요",
  REF: "관찰 대상",
  WITHHELD: "판단 보류",
};

export const HINT_ORDER: ChargerHint[] = ["fast", "mixed", "slow"];

export const HINT_LABEL: Record<ChargerHint, string> = {
  fast: "원활",
  mixed: "보통",
  slow: "혼잡",
};

export const REASON_LABEL: Record<string, string> = {
  period_mismatch: "등록 기준월(2026년 9월)과 도로 관측 기간(10월 27~28일)이 다름 (MVP 예외 허용)",
  b_suppressed_no_source_time: "원천에 관측 시각이 없어 B 유형 판정은 비활성",
  supply_sufficient: "전기차 대수·증가율 기준은 넘었지만 충전기가 이미 충분해 우선 검토에서 제외",
  supply_period_mismatch: "충전기 이력이 11월 2일부터라 기준월 말일 대신 첫 수집일 공급을 사용 (MVP 예외)",
};

export const GROWTH_DESC: Record<string, string> = {
  "꾸준한 증가": "12개월 중 10개월 이상 증가",
  "최근 가속": "최근 3개월 증가율이 직전 3개월의 1.5배 이상이고 10% 이상",
  "한 달 몰림": "1년 증가분의 절반 이상이 한 달에 집중",
  "정체·변동": "뚜렷한 증가 흐름 없음",
};

export const DAG_LABEL: Record<string, string> = {
  bootstrap_collector: "초기 수집",
  ev01_traffic_collect: "도로 수집 (30분)",
  ev02_registration_monthly: "등록 수집 (월)",
  ev03_mart_integration: "지표·분류·게시",
  ev04_charger_daily: "충전기 수집 (일)",
  ev10_master_refresh: "도로-동 연결 마스터",
  ev11_reprocess: "재처리",
  ev12_quality_monitor: "품질 리포트",
  ev13_retention_cleanup: "보존 정리",
};

export const STATUS_LABEL: Record<string, string> = {
  success: "성공",
  partial: "일부 수집",
  unchanged: "변경 없음",
  held: "게시 보류",
  published: "게시",
  skipped_unchanged: "변경 없어 생략",
  failed: "실패",
};

// 형식 변환
const intFmt = new Intl.NumberFormat("ko-KR");

export const fmtInt = (n: number | null | undefined) => (n == null ? "-" : intFmt.format(n));

export const fmtPct = (n: number | null | undefined, digits = 1) => (n == null ? "-" : `${n.toFixed(digits)}%`);

export const fmtMonth = (ym: string) => `${ym.slice(0, 4)}.${ym.slice(4, 6)}`;

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
