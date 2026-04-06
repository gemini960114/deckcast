import { API_KEY_HEADER, AUTH_TOKEN_KEY, SESSION_KEY, encodeApiKey } from './constants';

export type UnauthorizedKind = 'apiKey' | 'auth';

let onUnauthorized: ((kind: UnauthorizedKind) => void) | null = null;

export function setUnauthorizedHandler(fn: (kind: UnauthorizedKind) => void) {
  onUnauthorized = fn;
}

export async function apiFetch(path: string, body: object): Promise<Response> {
  const raw = sessionStorage.getItem(SESSION_KEY) ?? '';
  const authToken = localStorage.getItem(AUTH_TOKEN_KEY) ?? '';
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [API_KEY_HEADER]: raw ? encodeApiKey(raw) : '',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    const errorBody = await res.clone().json().catch(() => null) as { code?: string } | null;

    if (errorBody?.code === 'AUTH_REQUIRED' || errorBody?.code === 'INVALID_SESSION') {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      onUnauthorized?.('auth');
      throw new Error('登入已失效，請重新驗證。');
    }

    sessionStorage.removeItem(SESSION_KEY);
    onUnauthorized?.('apiKey');
    throw new Error('Invalid or missing API Key');
  }

  return res;
}
