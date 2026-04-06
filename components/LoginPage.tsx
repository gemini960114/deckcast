'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { getGoogleClientId, loginWithGoogle, type AuthSession } from '@/lib/authClient';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

type LoginPageProps = {
  dark: boolean;
  onToggleTheme: () => void;
  onLogin: (session: AuthSession) => void;
};

export default function LoginPage({ dark, onToggleTheme, onLogin }: LoginPageProps) {
  const [invitationCode, setInvitationCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [googleLoaded, setGoogleLoaded] = useState(false);

  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleClientId = getGoogleClientId();
  const codeReady = invitationCode.trim().length > 0;

  useEffect(() => {
    if (!googleLoaded || !codeReady || isLoading || !googleClientId || !window.google || !googleButtonRef.current) {
      return;
    }

    googleButtonRef.current.innerHTML = '';
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async (response) => {
        if (!response.credential) {
          setError('Google 登入未取得憑證，請再試一次。');
          return;
        }

        if (!invitationCode.trim()) {
          setError('請先輸入邀請碼。');
          return;
        }

        setIsLoading(true);
        setError('');

        try {
          const session = await loginWithGoogle(response.credential, invitationCode.trim());
          onLogin(session);
        } catch (loginError) {
          setError(loginError instanceof Error ? loginError.message : '登入失敗，請稍後再試。');
        } finally {
          setIsLoading(false);
        }
      },
    });

    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: dark ? 'filled_black' : 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      width: 340,
      logo_alignment: 'left',
    });
  }, [codeReady, dark, googleClientId, googleLoaded, invitationCode, isLoading, onLogin]);

  return (
    <div className={`min-h-screen transition-colors duration-300 ${dark ? 'bg-[#08120f] text-slate-100' : 'bg-[#f5fbf8] text-slate-900'}`}>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setGoogleLoaded(true)} />

      <div className="relative overflow-hidden min-h-screen">
        <div className={`absolute inset-0 ${dark ? 'bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.22),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.18),_transparent_30%)]' : 'bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.14),_transparent_30%)]'}`} />
        <div className="relative min-h-screen px-5 py-8 md:px-8">
          <div className="mx-auto flex max-w-6xl items-start justify-between">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 backdrop-blur-sm">
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
                <rect width="32" height="32" rx="7" fill="#047857" />
                <rect x="4" y="9" width="15" height="11" rx="2" fill="white" />
                <rect x="6" y="12" width="8" height="1.5" rx="0.75" fill="#047857" opacity="0.45" />
                <rect x="6" y="15" width="5" height="1.5" rx="0.75" fill="#047857" opacity="0.45" />
                <path d="M22 13.5 Q25.5 16 22 18.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
                <path d="M24.5 11 Q29.5 16 24.5 21" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.55" />
              </svg>
              <div>
                <p className="text-sm font-extrabold tracking-tight text-emerald-400" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  DeckCast Access
                </p>
                <p className={`text-[11px] ${dark ? 'text-slate-400' : 'text-slate-600'}`}>雙重驗證入口</p>
              </div>
            </div>

            <button
              onClick={onToggleTheme}
              className={`rounded-full border px-4 py-2 text-xs font-semibold transition-all ${dark ? 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-emerald-700 hover:text-emerald-300' : 'border-slate-200 bg-white/80 text-slate-600 hover:border-emerald-500 hover:text-emerald-700'}`}
            >
              {dark ? '切換白天模式' : '切換夜晚模式'}
            </button>
          </div>

          <div className="mx-auto mt-10 grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <section className="space-y-6">
              <div className="space-y-4">
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] ${dark ? 'border-emerald-800 bg-emerald-900/30 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                  Secure Entry
                </span>
                <h1 className="max-w-2xl text-4xl font-extrabold leading-tight md:text-5xl" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  讓 PDF 簡報結合 Podcast 與 AI 歌曲，打造邊聽邊看的同步簡報體驗。
                </h1>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ['Step 1', '輸入邀請碼', '先確認你擁有有效的團隊邀請碼。'],
                  ['Step 2', 'Google 驗證', '使用受允許的 Google 帳號完成登入。'],
                  ['Step 3', '進入工作台', '通過後即可使用 Podcast 與歌曲簡報流程。'],
                ].map(([step, title, description]) => (
                  <div key={step} className={`rounded-3xl border p-4 backdrop-blur-sm ${dark ? 'border-white/10 bg-white/5' : 'border-white/80 bg-white/80 shadow-[0_20px_50px_rgba(15,23,42,0.06)]'}`}>
                    <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-500">{step}</p>
                    <h2 className="mt-3 text-base font-bold">{title}</h2>
                    <p className={`mt-2 text-sm leading-6 ${dark ? 'text-slate-400' : 'text-slate-600'}`}>{description}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className={`rounded-[32px] border p-6 shadow-2xl backdrop-blur-xl md:p-8 ${dark ? 'border-white/10 bg-slate-900/75 shadow-emerald-950/30' : 'border-white bg-white/90 shadow-[0_30px_80px_rgba(15,23,42,0.12)]'}`}>
              <div className="mb-8 space-y-2">
                <p className="text-xs font-bold uppercase tracking-[0.26em] text-emerald-500">Workspace Login</p>
                <h2 className="text-2xl font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>登入 DeckCast</h2>
                <p className={`text-sm leading-6 ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
                  邀請碼通過後才會啟用 Google 登入按鈕。這樣可以把驗證順序鎖定得更穩定。
                </p>
              </div>

              <div className="space-y-5">
                <div className="space-y-2">
                  <label className={`block text-xs font-bold uppercase tracking-[0.2em] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Step 1</label>
                  <input
                    type="text"
                    value={invitationCode}
                    onChange={(event) => {
                      setInvitationCode(event.target.value);
                      setError('');
                    }}
                    placeholder="輸入 invitation code"
                    disabled={isLoading}
                    className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-all ${dark ? 'border-slate-700 bg-slate-950/80 text-slate-100 placeholder:text-slate-600 focus:border-emerald-600' : 'border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:border-emerald-500'}`}
                  />
                </div>

                <div className="space-y-2">
                  <label className={`block text-xs font-bold uppercase tracking-[0.2em] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Step 2</label>
                  {!googleClientId ? (
                    <div className={`rounded-2xl border px-4 py-3 text-sm ${dark ? 'border-amber-900/60 bg-amber-950/40 text-amber-300' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                      尚未設定 `NEXT_PUBLIC_GOOGLE_CLIENT_ID`，請先補上 `.env.local` 再啟用登入。
                    </div>
                  ) : codeReady ? (
                    <div className={`rounded-2xl border px-4 py-4 ${dark ? 'border-slate-800 bg-slate-950/70' : 'border-slate-200 bg-slate-50'}`}>
                      <div ref={googleButtonRef} className="flex justify-center" />
                    </div>
                  ) : (
                    <div className={`flex items-center justify-center rounded-2xl border px-4 py-4 text-sm font-medium ${dark ? 'border-slate-800 bg-slate-950/70 text-slate-500' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                      請先輸入邀請碼，Google 按鈕才會解鎖
                    </div>
                  )}
                </div>

                {(isLoading || error) && (
                  <div className={`rounded-2xl border px-4 py-3 text-sm ${error ? (dark ? 'border-red-900/60 bg-red-950/40 text-red-300' : 'border-red-200 bg-red-50 text-red-700') : (dark ? 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}`}>
                    {error || '驗證中，請稍候...'}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
