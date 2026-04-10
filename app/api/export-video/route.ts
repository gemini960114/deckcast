import { NextRequest, NextResponse } from 'next/server';
import { isRequestAuthError, requireSession, unauthorizedResponse } from '@/lib/auth';
import {
  generateVideo,
  getActiveExports,
  getMaxConcurrentExports,
  isVideoExportEnabled,
  type GenerateVideoParams,
} from '@/lib/videoExport';
import type { SlideTimings } from '@/lib/types';

export const maxDuration = 600; // 10 minutes — FFmpeg encoding can be slow

const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB

interface ExportVideoRequest {
  images: string[];
  timings: SlideTimings;
  audioBase64: string;
  audioMimeType: string;
  transition?: 'fade' | 'none';
  resolution?: '720p' | '1080p';
  srt?: string; // reserved for Phase 3 subtitle burn-in; ignored in Phase 1
}

export async function POST(req: NextRequest) {
  // 1. Feature gate
  if (!isVideoExportEnabled()) {
    return NextResponse.json(
      { error: 'Video export is disabled. Set VIDEO_EXPORT_ENABLED=true to enable.' },
      { status: 403 },
    );
  }

  // 2. Body size check (App Router has no built-in bodyParser.sizeLimit)
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Payload too large (max ${MAX_BODY_BYTES / 1024 / 1024}MB)` },
      { status: 413 },
    );
  }

  // 3. Auth check (only when AUTH_ENABLED=true)
  try {
    requireSession(req);
  } catch (error) {
    if (isRequestAuthError(error)) return unauthorizedResponse(error);
    throw error;
  }

  // 4. Concurrency gate
  const maxConcurrent = getMaxConcurrentExports();
  const active = getActiveExports();
  if (active >= maxConcurrent) {
    return NextResponse.json(
      { error: `伺服器忙碌中（${active}/${maxConcurrent}），請稍後再試` },
      { status: 503 },
    );
  }

  // 5. Parse and validate body
  let body: ExportVideoRequest;
  try {
    body = (await req.json()) as ExportVideoRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.images) || body.images.length === 0) {
    return NextResponse.json({ error: 'Missing images' }, { status: 400 });
  }
  if (!Array.isArray(body.timings) || body.timings.length === 0) {
    return NextResponse.json({ error: 'Missing timings' }, { status: 400 });
  }
  if (!body.audioBase64 || !body.audioMimeType) {
    return NextResponse.json({ error: 'Missing audio data' }, { status: 400 });
  }
  if (body.images.length !== body.timings.length) {
    return NextResponse.json(
      { error: `images length (${body.images.length}) must match timings length (${body.timings.length})` },
      { status: 400 },
    );
  }

  // 6. Generate video
  const params: GenerateVideoParams = {
    images: body.images,
    timings: body.timings,
    audioBase64: body.audioBase64,
    audioMimeType: body.audioMimeType,
    transition: body.transition,
    resolution: body.resolution ?? '1080p',
  };

  try {
    const mp4Buffer = await generateVideo(params);
    const videoBlob = new Blob([mp4Buffer], { type: 'video/mp4' });
    return new NextResponse(videoBlob, {
      headers: {
        'Content-Length': String(mp4Buffer.byteLength),
        'Content-Disposition': 'attachment; filename="presentation.mp4"',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
