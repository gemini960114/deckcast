import { AUTH_EMAIL_KEY, AUTH_TOKEN_KEY } from './constants';

export type AuthSession = {
  token: string;
  email: string;
};

type AuthResponse = {
  token?: string;
  email?: string;
  error?: string;
};

export function isAuthEnabledClient() {
  return process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true';
}

export function getGoogleClientId() {
  return (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim();
}

export function readStoredAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  const token = localStorage.getItem(AUTH_TOKEN_KEY) ?? '';
  if (!token) return null;

  return {
    token,
    email: localStorage.getItem(AUTH_EMAIL_KEY) ?? '',
  };
}

export function storeAuthSession(token: string, email: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_EMAIL_KEY, email);
}

export function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_EMAIL_KEY);
}

export async function loginWithGoogle(credential: string, invitationCode: string) {
  const response = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential, invitationCode }),
  });

  const data = await response.json().catch(() => ({} as AuthResponse));
  if (!response.ok || !data.token) {
    throw new Error(data.error ?? '登入失敗，請稍後再試。');
  }

  return {
    token: data.token,
    email: data.email ?? '',
  };
}
