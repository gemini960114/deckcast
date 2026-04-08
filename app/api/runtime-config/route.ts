import { NextResponse } from 'next/server';
import { getLocalLlmLabel, isLocalLlmConfigured } from '@/lib/llm';

export async function GET() {
  return NextResponse.json({
    localLlmEnabled: isLocalLlmConfigured(),
    localLlmLabel: getLocalLlmLabel(),
  });
}
