// 테마 전환 (기본 라이트, 선택값은 브라우저에 저장)
import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "theme";

function readSaved(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readSaved);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // 저장 불가 환경은 무시
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "light" ? "dark" : "light"));
  return { theme, toggle };
}
