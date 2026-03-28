import { API_KEY_HEADER, SESSION_KEY, encodeApiKey } from './constants';

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function apiFetch(path: string, body: object): Promise<Response> {
  const raw = sessionStorage.getItem(SESSION_KEY) ?? '';
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [API_KEY_HEADER]: raw ? encodeApiKey(raw) : '',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    sessionStorage.removeItem(SESSION_KEY);
    onUnauthorized?.();
    throw new Error('Invalid or missing API Key');
  }

  return res;
}
