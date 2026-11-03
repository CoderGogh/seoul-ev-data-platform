// 사이드바 메뉴 (카테고리 → 페이지, minRole 없으면 공개)
import { hasRole, type Role } from "./auth/roles";

export type IconName =
  | "dashboard"
  | "star"
  | "map"
  | "list"
  | "target"
  | "trend"
  | "road"
  | "shield"
  | "activity"
  | "plug"
  | "flag"
  | "users"
  | "clock";

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  desc: string;
  minRole?: Role;
  hideLocked?: boolean; // 권한 없으면 메뉴에서 숨김
}

export interface NavGroup {
  title: string;
  tone: "blue" | "green" | "orange" | "purple" | "gray";
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "개요",
    tone: "blue",
    items: [{ to: "/", label: "대시보드", icon: "dashboard", desc: "핵심 수치와 주목할 동네" }],
  },
  {
    title: "지역 분석",
    tone: "blue",
    items: [
      { to: "/priority", label: "우선 검토 지역", icon: "star", desc: "충전소를 먼저 늘릴 동네" },
      { to: "/map", label: "지도", icon: "map", desc: "행정동 분류·도로 여건 지도" },
      { to: "/regions", label: "행정동 목록", icon: "list", desc: "67곳 정렬·필터 표" },
    ],
  },
  {
    title: "지표 분석",
    tone: "green",
    items: [
      { to: "/criteria", label: "판정 기준", icon: "target", desc: "우선 검토 기준과 근접 동" },
      { to: "/trend", label: "전기차 추세", icon: "trend", desc: "13개월 등록 추세·증가 양상" },
      { to: "/road", label: "도로 여건", icon: "road", desc: "저속 비중·시간대 속도" },
      { to: "/supply", label: "충전기 공급", icon: "plug", desc: "동별 충전기·전기차 대비 공급" },
    ],
  },
  {
    title: "데이터 운영",
    tone: "orange",
    items: [
      { to: "/quality", label: "데이터 품질", icon: "shield", desc: "게시 상태·품질 관문", minRole: "operator" },
      { to: "/pipeline", label: "파이프라인 실행", icon: "activity", desc: "DAG 실행·수집 현황", minRole: "operator" },
      { to: "/progress", label: "개발 진행", icon: "flag", desc: "로드맵·병합 이력", minRole: "operator" },
      { to: "/versions", label: "데이터 버전", icon: "clock", desc: "원천별 기준일·게시·배포 버전", minRole: "operator", hideLocked: true },
    ],
  },
  {
    title: "관리",
    tone: "purple",
    items: [{ to: "/admin/users", label: "사용자 권한", icon: "users", desc: "가입자 역할 지정", minRole: "admin", hideLocked: true }],
  },
];

// 현재 경로의 메뉴 항목 (상세 페이지는 상위 메뉴)
export function activeItem(path: string): NavItem | undefined {
  const all = NAV_GROUPS.flatMap((g) => g.items);
  if (path.startsWith("/regions/")) return all.find((i) => i.to === "/regions");
  return all.find((i) => i.to === path);
}

// 첫 화면 왼쪽 바: 대시보드 구역 바로가기
export const HOME_SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: "dash-quick", label: "화면 바로가기", icon: "dashboard" },
  { id: "dash-stats", label: "핵심 수치", icon: "target" },
  { id: "dash-supply", label: "충전기 공급", icon: "plug" },
  { id: "dash-rank", label: "우선 검토 순위·위치", icon: "star" },
  { id: "dash-watch", label: "주목할 동네", icon: "flag" },
  { id: "dash-summary", label: "추세·도로·상태", icon: "trend" },
];

// 로그인 화면 (메뉴 외 항목)
export const LOGIN_ITEM: NavItem = { to: "/login", label: "로그인", icon: "users", desc: "Google·Kakao 로그인" };

// 역할별 노출 메뉴 (hideLocked 항목은 권한 있을 때만)
export function visibleGroups(role?: Role | null): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.hideLocked || hasRole(role, i.minRole)),
  })).filter((g) => g.items.length > 0);
}

// 메뉴 항목의 카테고리 (상단 탭 표시)
export function groupOf(item: NavItem | undefined): NavGroup | undefined {
  return item && NAV_GROUPS.find((g) => g.items.includes(item));
}
