import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 웹 배포 버전 (Vercel 시스템 변수, 로컬은 local)
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const build = {
  sha: env.VERCEL_GIT_COMMIT_SHA ?? "local",
  ref: env.VERCEL_GIT_COMMIT_REF ?? "",
  env: env.VERCEL_ENV ?? "local",
  at: new Date().toISOString(),
};

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(build) },
});
