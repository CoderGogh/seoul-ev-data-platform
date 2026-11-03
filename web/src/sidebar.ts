// 사이드바 접기 상태 (데스크톱, 선택값은 브라우저에 저장)
import { useEffect, useState } from "react";

const KEY = "sidebar";

function readSaved(): boolean {
  try {
    return localStorage.getItem(KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function useCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(readSaved);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, collapsed ? "collapsed" : "expanded");
    } catch {
      // 저장 불가 환경은 무시
    }
  }, [collapsed]);

  return { collapsed, toggle: () => setCollapsed((v) => !v) };
}
