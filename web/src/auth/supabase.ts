// Supabase 클라이언트 (환경변수 없으면 로그인 비활성)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } }) : null;
