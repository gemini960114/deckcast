import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_HEADER, decodeApiKey } from './constants';
import { RequestAuthError, requireSession, unauthorizedResponse as authUnauthorizedResponse } from './auth';

export function getGeminiAI(req: NextRequest) {
  requireSession(req);

  const encoded = req.headers.get(API_KEY_HEADER);
  if (!encoded) throw new RequestAuthError('MISSING_API_KEY', 'Missing or invalid API Key', 401);

  let apiKey = '';
  try {
    apiKey = decodeApiKey(encoded);
  } catch {
    throw new RequestAuthError('MISSING_API_KEY', 'Missing or invalid API Key', 401);
  }

  if (!apiKey) throw new RequestAuthError('MISSING_API_KEY', 'Missing or invalid API Key', 401);
  return new GoogleGenAI({ apiKey });
}

export function getAI(req: NextRequest) {
  return getGeminiAI(req);
}

export function unauthorizedResponse(error?: unknown) {
  if (error) return authUnauthorizedResponse(error);
  return NextResponse.json({ error: 'Missing or invalid API Key', code: 'MISSING_API_KEY' }, { status: 401 });
}
