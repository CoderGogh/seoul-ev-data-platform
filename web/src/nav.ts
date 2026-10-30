// 사이드바 메뉴 (카테고리 → 페이지)
export type IconName =
  | "dashboard"
  | "star"
  | "map"
  | "list"
  | "target"
  | "trend"
  | "road"
  | "shield"
  | "activity";

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  desc: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "개요",
    items: [{ to: "/", label: "대시보드", icon: "dashboard", desc: "핵심 수치와 주목할 동네" }],
  },
  {
    title: "지역 분석",
    items: [
      { to: "/priority", label: "우선 검토 지역", icon: "star", desc: "충전소를 먼저 늘릴 12곳" },
      { to: "/map", label: "지도", icon: "map", desc: "행정동 분류·도로 여건 지도" },
      { to: "/regions", label: "행정동 목록", icon: "list", desc: "67곳 정렬·필터 표" },
    ],
  },
  {
    title: "지표 분석",
    items: [
      { to: "/criteria", label: "판정 기준", icon: "target", desc: "우선 검토 기준과 근접 동" },
      { to: "/trend", label: "전기차 추세", icon: "trend", desc: "13개월 등록 추세·증가 양상" },
      { to: "/road", label: "도로 여건", icon: "road", desc: "저속 비중·시간대 속도" },
    ],
  },
  {
    title: "데이터 운영",
    items: [
      { to: "/quality", label: "데이터 품질", icon: "shield", desc: "게시 상태·품질 관문" },
      { to: "/pipeline", label: "파이프라인 실행", icon: "activity", desc: "DAG 실행·수집 현황" },
    ],
  },
];

// 현재 경로의 메뉴 항목 (상세 페이지는 상위 메뉴)
export function activeItem(path: string): NavItem | undefined {
  const all = NAV_GROUPS.flatMap((g) => g.items);
  if (path.startsWith("/regions/")) return all.find((i) => i.to === "/regions");
  return all.find((i) => i.to === path);
}
