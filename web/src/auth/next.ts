// 로그인 후 이동 경로 (내부 경로만 허용)
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || next.startsWith("/login")) return "/";
  return next;
}
