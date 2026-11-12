// Slack 보고 알림 문구 (Deno·브라우저 공용, 외부 의존 없음)
export interface ReportRow {
  id: number;
  target: string;
  body: string;
  base_month: string | null;
}

const MAX_BODY = 500;

// Slack mrkdwn 특수문자 이스케이프 (링크·멘션 주입 방지)
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 대상 키 → 화면 경로
export const pathOf = (target: string) => (target.startsWith("region:") ? `/regions/${target.slice(7)}` : target.slice(5));

export function slackMessage(r: ReportRow, author: string, label: string, siteUrl: string) {
  const body = r.body.length > MAX_BODY ? `${r.body.slice(0, MAX_BODY)}…` : r.body;
  const url = `${siteUrl.replace(/\/$/, "")}${pathOf(r.target)}`;
  const month = r.base_month ? ` · ${r.base_month.slice(0, 4)}.${r.base_month.slice(4)} 기준` : "";
  return {
    text: `새 보고: ${author} · ${label}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*새 보고* · ${esc(author)} → 팀장\n<${url}|${esc(label)}>${month}` } },
      { type: "section", text: { type: "mrkdwn", text: esc(body) } },
    ],
  };
}
