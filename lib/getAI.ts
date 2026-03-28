import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_HEADER, decodeApiKey } from './constants';

export function getAI(req: NextRequest) {
  const encoded = req.headers.get(API_KEY_HEADER);
  if (!encoded) throw new Error('Missing API Key');
  const apiKey = decodeApiKey(encoded);
  return new GoogleGenAI({ apiKey });
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Missing or invalid API Key' }, { status: 401 });
}
