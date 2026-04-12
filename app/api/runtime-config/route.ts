import { NextResponse } from 'next/server';
import { getLocalLlmLabel, isLocalLlmConfigured } from '@/lib/llm';

export async function GET() {
  return NextResponse.json({
    localLlmEnabled: isLocalLlmConfigured(),
    localLlmLabel: getLocalLlmLabel(),
    videoExportEnabled: process.env.VIDEO_EXPORT_ENABLED === 'true',
    ttsChunkingEnabled: process.env.TTS_CHUNKING_ENABLED === 'true',
  });
}
