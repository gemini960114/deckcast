import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getEmailFromRequest, logUsage } from '@/lib/usageLogger';

export const maxDuration = 120;

const execFileAsync = promisify(execFile);

const MAX_BODY_BYTES = 80 * 1024 * 1024; // 80 MB (50MB file → ~67MB base64)

function getFFmpegBinary(): string {
  const bin = (process.env.VIDEO_FFMPEG_BIN ?? '').trim();
  if (bin) return path.join(bin, 'ffmpeg');
  return 'ffmpeg';
}

function getTempDir(): string {
  return process.platform === 'win32'
    ? path.join(os.tmpdir(), 'podcast-normalize')
    : '/tmp/podcast-normalize';
}

export async function POST(req: NextRequest) {
  logUsage(getEmailFromRequest(req), 'normalize-podcast-audio');

  const contentLength = req.headers.get('content-length');
  if (contentLength !== null) {
    const len = parseInt(contentLength, 10);
    if (!isNaN(len) && len > MAX_BODY_BYTES) {
      return NextResponse.json({ error: '檔案太大（最大 60MB）' }, { status: 413 });
    }
  }

  let body: { audioBase64: string; mimeType: string };
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return NextResponse.json({ error: '檔案太大（最大 60MB）' }, { status: 413 });
    }
    body = JSON.parse(raw) as { audioBase64: string; mimeType: string };
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { audioBase64, mimeType } = body;
  if (!audioBase64 || !mimeType) {
    return NextResponse.json({ error: 'Missing audioBase64 or mimeType' }, { status: 400 });
  }

  const inputBuffer = Buffer.from(audioBase64, 'base64');
  const tmpDir = getTempDir();
  await fs.mkdir(tmpDir, { recursive: true });

  const id = crypto.randomUUID();
  const ext = mimeTypeToExt(mimeType);
  const inputPath = path.join(tmpDir, `${id}.${ext}`);
  const outputPath = path.join(tmpDir, `${id}.mp3`);

  try {
    await fs.writeFile(inputPath, inputBuffer);

    await execFileAsync(
      getFFmpegBinary(),
      [
        '-y',
        '-i', inputPath,
        '-ac', '1',
        '-ar', '24000',
        '-b:a', '128k',
        outputPath,
      ],
      { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 },
    );

    const mp3Buffer = await fs.readFile(outputPath);
    return new NextResponse(mp3Buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(mp3Buffer.byteLength),
      },
    });
  } catch (err) {
    console.error('[normalize-podcast-audio] ffmpeg error:', err);
    return NextResponse.json(
      { error: `音檔標準化失敗：${String(err)}` },
      { status: 500 },
    );
  } finally {
    await Promise.allSettled([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {}),
    ]);
  }
}

function mimeTypeToExt(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('wav')) return 'wav';
  if (m.includes('m4a') || m.includes('mp4')) return 'm4a';
  if (m.includes('aac')) return 'aac';
  return 'wav';
}
