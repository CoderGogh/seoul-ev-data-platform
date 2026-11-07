// 게시 이력: 직전 게시(같은 기준월 또는 이전) 대비 A 목록 변화
import type { PublishEntry } from "./data";

export interface PublishDiff {
  entry: PublishEntry;
  added: string[];
  removed: string[];
  comparable: boolean; // 직전·현재 모두 A 목록 기록 있음
}

// 시간순 이력 → 최신순 변화 목록
export function publishDiffs(publishes: PublishEntry[]): PublishDiff[] {
  const sorted = [...publishes].sort((a, b) => a.published_at.localeCompare(b.published_at));
  return sorted
    .map((entry, i) => {
      const prev = sorted[i - 1];
      const comparable = Boolean(prev?.a_list && entry.a_list);
      const cur = new Set(entry.a_list ?? []);
      const before = new Set(prev?.a_list ?? []);
      return {
        entry,
        comparable,
        added: comparable ? [...cur].filter((c) => !before.has(c)) : [],
        removed: comparable ? [...before].filter((c) => !cur.has(c)) : [],
      };
    })
    .reverse();
}
