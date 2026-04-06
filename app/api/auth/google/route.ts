import { NextRequest, NextResponse } from 'next/server';
import {
  createSessionToken,
  enforceLoginRateLimit,
  isAuthEnabled,
  unauthorizedResponse,
  validateInvitationCode,
  verifyGoogleCredential,
} from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ error: 'AUTH_ENABLED=false，目前未啟用登入機制。' }, { status: 400 });
  }

  try {
    enforceLoginRateLimit(req);
    const { credential, invitationCode } = await req.json();

    if (typeof credential !== 'string' || typeof invitationCode !== 'string') {
      return NextResponse.json({ error: '缺少必要的登入參數。' }, { status: 400 });
    }

    validateInvitationCode(invitationCode);
    const email = await verifyGoogleCredential(credential);
    const token = createSessionToken(email);

    return NextResponse.json({ token, email });
  } catch (error) {
    return unauthorizedResponse(error);
  }
}
