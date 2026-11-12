// 로그인 상태·프로필 (Google·Kakao OAuth)
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { safeNext } from "./next";
import { supabase } from "./supabase";
import type { Role } from "./roles";

export type Provider = "google" | "kakao";

export interface Profile {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  provider: string | null;
  role: Role;
  is_super: boolean;
  created_at: string;
  role_updated_at: string | null;
}

interface AuthState {
  enabled: boolean;
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  signIn: (provider: Provider, next?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export const PROFILE_COLS = "id,email,name,avatar_url,provider,role,is_super,created_at,role_updated_at";

// 로컬 개발 미리보기 역할 (로그인 미설정·개발 서버 한정)
export const DEV_ROLE = import.meta.env.DEV && !supabase ? (import.meta.env.VITE_DEV_ROLE as Role | undefined) : undefined;
const DEV_PROFILE: Profile | null = DEV_ROLE
  ? { id: "dev", email: null, name: "로컬 미리보기", avatar_url: null, provider: null, role: DEV_ROLE, is_super: false, created_at: "", role_updated_at: null }
  : null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(DEV_PROFILE);
  const [loading, setLoading] = useState(!!supabase);

  // 세션 변화 구독
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // 세션 사용자 프로필 조회
  const uid = session?.user.id;
  useEffect(() => {
    if (!supabase || !uid) return;
    let alive = true;
    setLoading(true);
    supabase
      .from("profiles")
      .select(PROFILE_COLS)
      .eq("id", uid)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setProfile((data as Profile | null) ?? null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [uid]);

  const signIn = useCallback(async (provider: Provider, next = "/") => {
    if (!supabase) return;
    const redirectTo = `${window.location.origin}/login?next=${encodeURIComponent(safeNext(next))}`;
    await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthCtx.Provider value={{ enabled: !!supabase, loading, session, profile, signIn, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("AuthProvider 밖에서 useAuth 호출");
  return v;
}

