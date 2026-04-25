import { NextRequest, NextResponse } from 'next/server';
import { isRequestAuthError, requireSession, unauthorizedResponse } from '@/lib/auth';
import { logUsage, getEmailFromRequest } from '@/lib/usageLogger';
import {
  generateVideo,
  getActiveExports,
  getMaxConcurrentExports,
  isVideoExportEnabled,
  VIDEO_TRANSITIONS,
  type GenerateVideoParams,
  type SubtitleStyle,
  type VideoTransition,
} from '@/lib/videoExport';
import type { SlideTimings } from '@/lib/types';

const SUBTITLE_STYLES: readonly SubtitleStyle[] = ['opaque', 'translucent', 'outline'] as const;
function isSubtitleStyle(v: unknown): v is SubtitleStyle {
  return typeof v === 'string' && (SUBTITLE_STYLES as readonly string[]).includes(v);
}

function isVideoTransition(v: unknown): v is VideoTransition {
  return typeof v === 'string' && (VIDEO_TRANSITIONS as readonly string[]).includes(v);
}

export const maxDuration = 600; // 10 minutes — FFmpeg encoding can be slow

// 50MB audio × base64 ≈ 67MB + up to 15 slides JPEG ≈ 5MB → 150MB with 2× safety margin
const MAX_BODY_BYTES = 150 * 1024 * 1024; // 150 MB

interface ExportVideoRequest {
  images: string[];
  timings: SlideTimings;
  audioBase64: string;
  audioMimeType: string;
  transition?: VideoTransition;
  resolution?: '720p' | '1080p';
  srtText?: string;
  burnSubs?: boolean;
  subtitleStyle?: SubtitleStyle;
}

export async function POST(req: NextRequest) {
  logUsage(getEmailFromRequest(req), 'export-video');
  // 1. Feature gate
  if (!isVideoExportEnabled()) {
    return NextResponse.json(
      { error: 'Video export is disabled. Set VIDEO_EXPORT_ENABLED=true to enable.' },
      { status: 403 },
    );
  }

  // 2. Body size check — pre-flight via Content-Length (best effort; may be absent from proxies)
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!isNaN(contentLength) && contentLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: `Payload too large (max ${MAX_BODY_BYTES / 1024 / 1024}MB)` },
        { status: 413 },
      );
    }
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

  // 5. Read raw body and enforce real payload size (guards against missing Content-Length)
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'Failed to read request body' }, { status: 400 });
  }
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Payload too large (max ${MAX_BODY_BYTES / 1024 / 1024}MB)` },
      { status: 413 },
    );
  }

  // 6. Parse and validate body
  let body: ExportVideoRequest;
  try {
    body = JSON.parse(rawBody) as ExportVideoRequest;
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

  // 7. Generate video
  const params: GenerateVideoParams = {
    images: body.images,
    timings: body.timings,
    audioBase64: body.audioBase64,
    audioMimeType: body.audioMimeType,
    transition: isVideoTransition(body.transition) ? body.transition : 'fade',
    resolution: body.resolution ?? '1080p',
    srtText: body.burnSubs ? (body.srtText ?? undefined) : undefined,
    burnSubs: body.burnSubs === true && !!body.srtText,
    subtitleStyle: isSubtitleStyle(body.subtitleStyle) ? body.subtitleStyle : undefined,
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
