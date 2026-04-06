import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { NextRequest, NextResponse } from 'next/server';

type SessionPayload = {
  user: string;
  exp: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type AuthErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_SESSION'
  | 'MISSING_API_KEY'
  | 'RATE_LIMITED'
  | 'INVALID_INVITATION_CODE'
  | 'GOOGLE_OAUTH_NOT_CONFIGURED'
  | 'INVALID_GOOGLE_TOKEN';

export class RequestAuthError extends Error {
  code: AuthErrorCode;
  status: number;

  constructor(code: AuthErrorCode, message: string, status: number) {
    super(message);
    this.name = 'RequestAuthError';
    this.code = code;
    this.status = status;
  }
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const globalRateLimitStore = globalThis as typeof globalThis & {
  __deckcastLoginRateLimit?: Map<string, RateLimitBucket>;
};

const loginRateLimitStore = globalRateLimitStore.__deckcastLoginRateLimit ?? new Map<string, RateLimitBucket>();
globalRateLimitStore.__deckcastLoginRateLimit = loginRateLimitStore;

let cachedGoogleClientId = '';
let cachedGoogleOAuthClient: OAuth2Client | null = null;

export function isAuthEnabled() {
  return process.env.AUTH_ENABLED === 'true';
}

function getInvitationCode() {
  return (process.env.INVITATION_CODE ?? '').trim();
}

function getSessionSecret() {
  return (process.env.SESSION_SECRET ?? getInvitationCode() ?? '').trim();
}

function getGoogleClientId() {
  return (process.env.GOOGLE_CLIENT_ID ?? '').trim();
}

function getGoogleOAuthClient() {
  const clientId = getGoogleClientId();
  if (!clientId) return null;

  if (clientId !== cachedGoogleClientId) {
    cachedGoogleClientId = clientId;
    cachedGoogleOAuthClient = new OAuth2Client(clientId);
  }

  return cachedGoogleOAuthClient;
}

function getRequestIp(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function cleanupRateLimitStore(now: number) {
  for (const [key, bucket] of loginRateLimitStore.entries()) {
    if (bucket.resetAt <= now) loginRateLimitStore.delete(key);
  }
}

export function enforceLoginRateLimit(req: NextRequest) {
  const now = Date.now();
  cleanupRateLimitStore(now);

  const ip = getRequestIp(req);
  const bucket = loginRateLimitStore.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    loginRateLimitStore.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }

  if (bucket.count >= LOGIN_MAX_ATTEMPTS) {
    throw new RequestAuthError('RATE_LIMITED', '登入嘗試次數過多，請稍後再試。', 429);
  }

  bucket.count += 1;
}

export function validateInvitationCode(invitationCode: string) {
  const expectedInvitationCode = getInvitationCode();
  if (!expectedInvitationCode || invitationCode.trim() !== expectedInvitationCode) {
    throw new RequestAuthError('INVALID_INVITATION_CODE', '邀請碼驗證失敗，請確認後再試。', 401);
  }
}

export function createSessionToken(user: string) {
  const sessionSecret = getSessionSecret();
  if (!sessionSecret) {
    throw new RequestAuthError('INVALID_SESSION', 'Session secret 尚未設定。', 500);
  }

  const payload: SessionPayload = {
    user,
    exp: Date.now() + TOKEN_TTL_MS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string) {
  try {
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return null;

    const sessionSecret = getSessionSecret();
    if (!sessionSecret) return null;

    const expectedSignature = crypto.createHmac('sha256', sessionSecret).update(encodedPayload).digest('base64url');
    if (signature !== expectedSignature) return null;

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString()) as SessionPayload;
    if (!payload?.user || !payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function requireSession(req: NextRequest) {
  if (!isAuthEnabled()) return null;

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new RequestAuthError('AUTH_REQUIRED', '請先登入後再使用系統。', 401);
  }

  const token = authHeader.slice(7).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    throw new RequestAuthError('INVALID_SESSION', '登入狀態已失效，請重新登入。', 403);
  }

  return payload;
}

export async function verifyGoogleCredential(credential: string) {
  const googleOAuthClient = getGoogleOAuthClient();
  const googleClientId = getGoogleClientId();

  if (!googleOAuthClient || !googleClientId) {
    throw new RequestAuthError('GOOGLE_OAUTH_NOT_CONFIGURED', 'Google OAuth 尚未設定完成。', 503);
  }

  try {
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: credential,
      audience: googleClientId,
    });

    const email = ticket.getPayload()?.email;
    if (!email) {
      throw new RequestAuthError('INVALID_GOOGLE_TOKEN', 'Google 帳號驗證失敗，請再試一次。', 401);
    }

    return email;
  } catch (error) {
    if (error instanceof RequestAuthError) throw error;
    throw new RequestAuthError('INVALID_GOOGLE_TOKEN', 'Google 帳號驗證失敗，請再試一次。', 401);
  }
}

export function isRequestAuthError(error: unknown): error is RequestAuthError {
  return error instanceof RequestAuthError;
}

export function unauthorizedResponse(error?: unknown) {
  if (error instanceof RequestAuthError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }

  return NextResponse.json(
    { error: '未授權的請求', code: 'AUTH_REQUIRED' },
    { status: 401 }
  );
}
