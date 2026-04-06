import { NextRequest, NextResponse } from 'next/server';
import {
  createSessionToken,
  enforceLoginRateLimit,
  isAuthEnabled,
  unauthorizedResponse,
  validateInvitationCode,
} from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ error: 'AUTH_ENABLED=false，目前未啟用登入機制。' }, { status: 400 });
  }

  try {
    enforceLoginRateLimit(req);
    const { invitationCode } = await req.json();

    if (typeof invitationCode !== 'string') {
      return NextResponse.json({ error: '缺少 invitationCode。' }, { status: 400 });
    }

    validateInvitationCode(invitationCode);
    const token = createSessionToken('authorized');

    return NextResponse.json({ token });
  } catch (error) {
    return unauthorizedResponse(error);
  }
}
