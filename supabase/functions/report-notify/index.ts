// 새 보고 Slack 알림: 작성자 본인 호출, 보고당 1회 (claim_report_notify)
// 비밀값: SLACK_REPORT_WEBHOOK_URL, SITE_URL (supabase secrets set)
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { slackMessage, type ReportRow } from "./message.ts";

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://seoul-ev-insight.vercel.app";
const CORS = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST만" });

  const auth = req.headers.get("Authorization");
  if (!auth) return json(401, { error: "로그인 필요" });
  const { id, label } = await req.json().catch(() => ({}));
  if (!Number.isInteger(id)) return json(400, { error: "보고 번호 없음" });

  // 호출자 권한으로만 조회 (RLS: 본인 보고)
  const db = createClient(Deno.env.get("SUPABASE_URL")!, (Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SB_PUBLISHABLE_KEY"))!, {
    global: { headers: { Authorization: auth } },
  });
  const webhook = Deno.env.get("SLACK_REPORT_WEBHOOK_URL");
  if (!webhook) return json(200, { sent: false, reason: "Slack 미설정" });

  const claim = await db.rpc("claim_report_notify", { report_id: id });
  if (claim.error) return json(403, { error: "권한 없음" });
  if (!claim.data) return json(200, { sent: false, reason: "이미 알림" });

  const { data: r, error } = await db.from("reports").select("id,target,body,base_month,author").eq("id", id).single();
  if (error || !r) return json(404, { error: "보고 없음" });
  const staff = await db.rpc("list_staff");
  const author = (staff.data as { id: string; name: string }[] | null)?.find((s) => s.id === r.author)?.name ?? "운영 담당";
  const text = typeof label === "string" && label.trim() ? label.trim().slice(0, 60) : r.target;

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slackMessage(r as ReportRow, author, text, SITE_URL)),
  });
  return res.ok ? json(200, { sent: true }) : json(502, { sent: false, reason: `Slack HTTP ${res.status}` });
});
