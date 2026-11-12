// 로그인 화면 (Google·Kakao), 로그인 후 원래 경로로 이동
import { useEffect, useState } from "react";
import { useAuth, type Provider } from "../auth/AuthContext";
import { safeNext } from "../auth/next";
import { ROLE_LABEL } from "../auth/roles";
import { navigate } from "../router";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.4 5.7c4.3-4 6.9-9.9 6.9-17.2z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function KakaoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#000000" d="M12 3C6.5 3 2 6.5 2 10.8c0 2.8 1.9 5.2 4.7 6.6l-1 3.6c-.1.3.3.6.6.4l4.2-2.8c.5.1 1 .1 1.5.1 5.5 0 10-3.5 10-7.9S17.5 3 12 3z" />
    </svg>
  );
}

export function Login() {
  const { enabled, loading, session, profile, signIn, signOut } = useAuth();
  const next = safeNext(new URLSearchParams(window.location.search).get("next"));
  const [busy, setBusy] = useState<Provider | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // OAuth 오류 표시 (리다이렉트 쿼리)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const e = q.get("error_description") || q.get("error");
    if (e) setErr(e);
  }, []);

  // 로그인 완료·승인된 사용자는 원래 경로로
  useEffect(() => {
    if (session && profile && profile.role !== "pending") navigate(next);
  }, [session, profile, next]);

  const go = async (p: Provider) => {
    setBusy(p);
    setErr(null);
    try {
      await signIn(p, next);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="login-wrap">
      <section className="card card-body login-card">
        <span className="brand-mark login-mark" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
          </svg>
        </span>
        <h1>로그인</h1>
        <p className="login-sub">분석 화면은 로그인 없이 볼 수 있습니다. 데이터 운영 화면은 역할을 받은 뒤 열립니다.</p>

        {!enabled && <p className="login-err">로그인 기능이 설정되지 않은 배포입니다.</p>}

        {enabled && session && profile?.role === "pending" && (
          <div className="login-pending">
            <b>{profile.name || profile.email}</b>님, 가입됐습니다. 현재 권한은 <b>{ROLE_LABEL.pending}</b>입니다. 관리자가 역할을
            지정하면 운영 화면이 열립니다.
            <button className="btn btn-sm btn-primary" onClick={() => signOut()}>
              로그아웃
            </button>
          </div>
        )}

        {enabled && session && !profile && !loading && (
          <div className="login-pending">
            로그인은 됐지만 프로필을 찾지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 알려 주세요.
            <button className="btn btn-sm btn-primary" onClick={() => signOut()}>
              로그아웃
            </button>
          </div>
        )}

        {enabled && !session && (
          <div className="login-btns">
            <button className="oauth-btn oauth-google" onClick={() => go("google")} disabled={!!busy || loading}>
              <GoogleMark />
              {busy === "google" ? "이동 중…" : "Google로 계속하기"}
            </button>
            <button className="oauth-btn oauth-kakao" onClick={() => go("kakao")} disabled={!!busy || loading}>
              <KakaoMark />
              {busy === "kakao" ? "이동 중…" : "카카오로 계속하기"}
            </button>
          </div>
        )}

        {err && <p className="login-err">로그인하지 못했습니다. {err}</p>}
        <p className="login-foot">이름·이메일·프로필 사진만 받아 역할 관리에 씁니다.</p>
      </section>
    </div>
  );
}
