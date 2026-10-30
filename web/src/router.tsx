// 경로 라우팅 (History API, 화면 4개)
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

export function navigate(to: string) {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

interface LinkProps {
  to: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  "aria-current"?: "page";
}

export function Link({ to, children, ...rest }: LinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // 새 탭 열기 등 기본 동작 유지
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
