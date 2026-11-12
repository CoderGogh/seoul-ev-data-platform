// Slack 보고 문구: 특수문자 이스케이프·길이 제한·화면 링크
import { describe, expect, it } from "vitest";
import { esc, slackMessage } from "../../supabase/functions/report-notify/message";

describe("slackMessage", () => {
  it("동 링크·기준월, 본문 <>& 이스케이프·500자 제한", () => {
    const m = slackMessage(
      { id: 1, target: "region:1168058000", body: `<!channel> & ${"가".repeat(600)}`, base_month: "202609" },
      "운영1",
      "역삼1동",
      "https://x.app/",
    );
    expect(m.blocks[0].text.text).toContain("<https://x.app/regions/1168058000|역삼1동> · 2026.09 기준");
    expect(m.blocks[1].text.text.startsWith("&lt;!channel&gt; &amp; ")).toBe(true);
    expect(m.blocks[1].text.text.endsWith("…")).toBe(true);
  });

  it("화면 대상 경로, 이름 이스케이프", () => {
    const m = slackMessage({ id: 2, target: "page:/quality", body: "확인", base_month: null }, "<@U1>", "품질", "https://x.app");
    expect(m.blocks[0].text.text).toBe("*새 보고* · &lt;@U1&gt; → 팀장\n<https://x.app/quality|품질>");
    expect(esc("a<b>")).toBe("a&lt;b&gt;");
  });
});
