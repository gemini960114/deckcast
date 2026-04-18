import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { SlideTimings } from './types';
import {
  TRANSITION_COMPENSATION_SEC,
  MIN_VISIBLE_SLIDE_SEC,
  LAST_SLIDE_TAIL_SEC,
} from './constants';
import { resolveEffectiveTransitionSec } from './timing';

const execFileAsync = promisify(execFile);

// Support VIDEO_FFMPEG_BIN for local Windows dev where ffmpeg may not be in PATH yet.
// In Docker/Cloud Run, ffmpeg is installed system-wide so this is just 'ffmpeg'.
function getFFmpegBinary(): string {
  const bin = (process.env.VIDEO_FFMPEG_BIN ?? '').trim();
  if (bin) return path.join(bin, 'ffmpeg');
  return 'ffmpeg';
}

// On Linux/Cloud Run: /tmp/video-export. On Windows dev: os.tmpdir()/video-export
const VIDEO_EXPORT_DIR = process.platform === 'win32'
  ? path.join(os.tmpdir(), 'video-export')
  : '/tmp/video-export';

// ─── Feature & config helpers ────────────────────────────────────────────────

export function isVideoExportEnabled(): boolean {
  return process.env.VIDEO_EXPORT_ENABLED === 'true';
}

/**
 * Map audio MIME type to file extension.
 * Must stay in sync with page.tsx getAudioExtension().
 * Supported upload formats: wav, mp3, m4a, aac.
 */
export function getAudioFileExtension(mimeType: string): string {
  const m = (mimeType ?? '').toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('aac')) return 'aac';
  return 'wav';
}

/**
 * Auto-select FFmpeg preset based on CPU count.
 * Manual override via VIDEO_FFMPEG_PRESET env var.
 *
 *   1 vCPU  → veryfast  (avoid timeout)
 *   2 vCPU  → fast      (balanced)
 *   4+ vCPU → medium    (quality-first)
 */
export function getFFmpegPreset(): string {
  const manual = (process.env.VIDEO_FFMPEG_PRESET ?? '').trim();
  if (manual) return manual;
  const cpuCount = os.cpus().length;
  if (cpuCount >= 4) return 'medium';
  if (cpuCount >= 2) return 'fast';
  return 'veryfast';
}

/**
 * Limit FFmpeg thread count to avoid saturating the host CPU.
 * Manual override via VIDEO_FFMPEG_THREADS env var.
 *
 * Default: min(2, cpuCount) — cap at 2 threads regardless of core count.
 * Set VIDEO_FFMPEG_THREADS=0 to let FFmpeg decide (uses all cores).
 */
export function getFFmpegThreads(): number {
  const manual = parseInt(process.env.VIDEO_FFMPEG_THREADS ?? '', 10);
  if (!isNaN(manual)) return manual;
  return Math.min(2, os.cpus().length);
}

/**
 * Auto-detect max concurrent exports from available memory.
 * Manual override via VIDEO_MAX_CONCURRENT env var (0 = auto).
 *
 * Each FFmpeg process needs ~340 MB (300 MB working set + 40 MB /tmp).
 * Reserve 500 MB for Node.js + OS. Minimum 1.
 */
export function getMaxConcurrentExports(): number {
  const manual = parseInt(process.env.VIDEO_MAX_CONCURRENT ?? '0', 10);
  if (manual > 0) return manual;
  const totalMemMB = os.totalmem() / (1024 * 1024);
  const reservedMB = 500;
  const perExportMB = 340;
  return Math.max(1, Math.floor((totalMemMB - reservedMB) / perExportMB));
}

// ─── Startup /tmp cleanup ────────────────────────────────────────────────────

/**
 * Clean up stale /tmp/video-export/{uuid}/ directories left by containers
 * that were killed before the finally-block cleanup could run.
 * Call once at server startup (instrumentation.ts).
 */
export async function cleanupStaleTempFiles(): Promise<void> {
  try {
    const entries = await fs.readdir(VIDEO_EXPORT_DIR).catch(() => [] as string[]);
    for (const entry of entries) {
      const fullPath = path.join(VIDEO_EXPORT_DIR, entry);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) continue;
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > 10 * 60 * 1000) {
        await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {});
        console.log(`[VideoExport] Cleaned stale temp dir: ${entry} (age: ${Math.round(ageMs / 1000)}s)`);
      }
    }
  } catch {
    // /tmp/video-export missing or no permission — non-fatal
  }
}

// ─── Active export tracking ──────────────────────────────────────────────────

let activeExports = 0;

export function getActiveExports(): number {
  return activeExports;
}

// ─── Subtitle helpers ────────────────────────────────────────────────────────

// YouTube-style subtitle: semi-transparent black background, system CJK font
const SUBTITLE_STYLE =
  'Fontname=Noto Sans CJK TC,BackColour=&HB0000000,BorderStyle=3,Outline=1,Shadow=0,Fontsize=22';

// FFmpeg subtitles filter requires forward slashes and escaped colons on Windows
function escapeSrtPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// ─── FFmpeg arg builders ─────────────────────────────────────────────────────

function buildConcatArgs(
  workDir: string,
  _timings: SlideTimings,
  audioPath: string,
  width: number,
  height: number,
  preset: string,
  threads: number,
  outputPath: string,
  srtPath: string | null = null,
): string[] {
  const threadArgs = threads > 0 ? ['-threads', String(threads), '-filter_threads', String(threads)] : [];
  const scale = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
  const vf = srtPath
    ? `${scale},subtitles='${escapeSrtPath(srtPath)}':force_style='${SUBTITLE_STYLE}'`
    : scale;
  return [
    '-y',
    ...threadArgs,
    '-f', 'concat', '-safe', '0', '-i', path.join(workDir, 'slides.txt'),
    '-i', audioPath,
    '-vf', vf,
    '-c:v', 'libx264', '-preset', preset, '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    '-shortest',
    outputPath,
  ];
}

/**
 * Build FFmpeg args for xfade-based slide transitions.
 *
 * Timing rule (plan_K):
 *   fadeDur[i] = resolveEffectiveTransitionSec(durationSec, 0.75, 0.5)
 *              = min(0.75, max(0.1, durationSec - 0.5))
 *   offset[i]  = timings[i].endSec - fadeDur[i]
 *   → slide i+1 is fully visible exactly at audio time timings[i].endSec
 *   → matches PPTX advTm behaviour (same resolveEffectiveTransitionSec logic)
 *
 * Duration fix:
 *   Each xfade overlap removes fadeDur[i] seconds from the output timeline.
 *   Fix: extend the last slide's -t by totalFadeDuration + LAST_SLIDE_TAIL_SEC.
 *   -shortest is omitted so the video runs its full extended duration,
 *   giving a silent tail with the last slide visible — matching PPTX.
 */
function buildXfadeArgs(
  workDir: string,
  timings: SlideTimings,
  audioPath: string,
  width: number,
  height: number,
  preset: string,
  threads: number,
  outputPath: string,
  srtPath: string | null = null,
): string[] {
  const n = timings.length;

  // Pre-compute all fade durations first — needed for last-slide extension.
  // Uses resolveEffectiveTransitionSec(), the same helper as buildTransitionAdjustedTimings(),
  // ensuring PPTX and MP4 apply identical fade logic per slide.
  const fadeDurs: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    fadeDurs.push(resolveEffectiveTransitionSec(
      timings[i].durationSec,
      TRANSITION_COMPENSATION_SEC,
      MIN_VISIBLE_SLIDE_SEC,
    ));
  }
  const TAIL_SEC = LAST_SLIDE_TAIL_SEC;

  const threadArgs = threads > 0 ? ['-threads', String(threads), '-filter_threads', String(threads)] : [];
  const args: string[] = ['-y', ...threadArgs];

  // One looped input per slide.
  // With direct offset formula (offset = endSec - fadeDur), each slide i (i > 0)
  // starts fading in at OUTPUT time = offset[i-1]. Its input must cover from that
  // point until the next transition starts, so it needs its own durationSec plus
  // the carry-in fade from the previous transition (fadeDurs[i-1]).
  // Last slide additionally gets TAIL_SEC for the silent tail after audio ends.
  for (let i = 0; i < n; i++) {
    const imgPath = path.join(workDir, `slide_${String(i + 1).padStart(3, '0')}.jpg`);
    const carryInFade = i > 0 ? fadeDurs[i - 1] : 0;
    const duration = timings[i].durationSec + carryInFade + (i === n - 1 ? TAIL_SEC : 0);
    args.push('-loop', '1', '-t', duration.toFixed(3), '-i', imgPath);
  }
  // Audio input (index n in FFmpeg's input list)
  args.push('-i', audioPath);

  const scale = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
  const filterParts: string[] = [];

  // Scale all slides to target resolution
  for (let i = 0; i < n; i++) {
    filterParts.push(`[${i}:v]${scale}[v${i}s]`);
  }

  // xfade chain — offset derived directly from semantic end time:
  //   offset = timings[i].endSec - fadeDur
  // This ensures slide i+1 is fully visible exactly at audio time timings[i].endSec,
  // matching PPTX behaviour (advTm = durationSec - 0.75s for non-last slides).
  const xfadeOutTag = srtPath ? '[vxf]' : '[vout]';
  for (let i = 0; i < n - 1; i++) {
    const fadeDur = fadeDurs[i];
    const offset = timings[i].endSec - fadeDur;

    const inputA = i === 0 ? '[v0s]' : `[xf${i - 1}]`;
    const inputB = `[v${i + 1}s]`;
    const outputTag = i === n - 2 ? xfadeOutTag : `[xf${i}]`;

    filterParts.push(
      `${inputA}${inputB}xfade=transition=fade:duration=${fadeDur.toFixed(3)}:offset=${offset.toFixed(3)}${outputTag}`,
    );
  }

  if (srtPath) {
    filterParts.push(
      `${xfadeOutTag}subtitles='${escapeSrtPath(srtPath)}':force_style='${SUBTITLE_STYLE}'[vout]`,
    );
  }

  args.push('-filter_complex', filterParts.join(';'));
  args.push('-map', '[vout]', '-map', `${n}:a`);
  args.push(
    '-c:v', 'libx264', '-preset', preset, '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    // No -shortest: video runs its full extended duration (audio padded with
    // silence for the last TAIL_SEC), matching PPTX last-slide behaviour.
    outputPath,
  );

  return args;
}

// ─── Main export function ────────────────────────────────────────────────────

export interface GenerateVideoParams {
  images: string[];         // base64 JPEG per slide
  timings: SlideTimings;
  audioBase64: string;
  audioMimeType: string;
  transition?: 'fade' | 'none';
  resolution?: '720p' | '1080p';
  srtText?: string;         // raw SRT content for hard-coded subtitle burn-in
  burnSubs?: boolean;       // if true + srtText provided, burn subtitles into video
}

export async function generateVideo(params: GenerateVideoParams): Promise<ArrayBuffer> {
  activeExports++;
  const workDir = path.join(VIDEO_EXPORT_DIR, crypto.randomUUID());
  await fs.mkdir(workDir, { recursive: true });

  try {
    // 1. Write slide images
    for (let i = 0; i < params.images.length; i++) {
      const imgPath = path.join(workDir, `slide_${String(i + 1).padStart(3, '0')}.jpg`);
      await fs.writeFile(imgPath, Buffer.from(params.images[i], 'base64'));
    }

    // 2. Write audio (extension from MIME type — supports wav/mp3/m4a/aac)
    const audioExt = getAudioFileExtension(params.audioMimeType);
    const audioPath = path.join(workDir, `audio.${audioExt}`);
    await fs.writeFile(audioPath, Buffer.from(params.audioBase64, 'base64'));

    // 3. Write SRT file if burn-in is requested
    let srtPath: string | null = null;
    if (params.burnSubs && params.srtText) {
      srtPath = path.join(workDir, 'subtitles.srt');
      await fs.writeFile(srtPath, params.srtText, 'utf8');
    }

    // 4. Build concat demuxer file (needed for 'none' / single-slide path)
    const concatLines: string[] = [];
    for (let i = 0; i < params.timings.length; i++) {
      concatLines.push(`file 'slide_${String(i + 1).padStart(3, '0')}.jpg'`);
      concatLines.push(`duration ${params.timings[i].durationSec.toFixed(3)}`);
    }
    // FFmpeg concat demuxer requires the last file to be listed twice (known behaviour)
    if (params.timings.length > 0) {
      concatLines.push(`file 'slide_${String(params.timings.length).padStart(3, '0')}.jpg'`);
    }
    await fs.writeFile(path.join(workDir, 'slides.txt'), concatLines.join('\n'));

    // 5. Build FFmpeg args — xfade for multi-slide fade, concat otherwise
    const [width, height] = params.resolution === '720p' ? [1280, 720] : [1920, 1080];
    const outputPath = path.join(workDir, 'output.mp4');
    const preset = getFFmpegPreset();
    const threads = getFFmpegThreads();

    const useFade = params.transition === 'fade' && params.timings.length > 1;
    const ffmpegArgs = useFade
      ? buildXfadeArgs(workDir, params.timings, audioPath, width, height, preset, threads, outputPath, srtPath)
      : buildConcatArgs(workDir, params.timings, audioPath, width, height, preset, threads, outputPath, srtPath);

    console.log(
      `[VideoExport] Starting FFmpeg: ${params.images.length} slides, ` +
      `transition=${params.transition ?? 'none'}, ` +
      `preset=${preset}, threads=${threads || 'auto'}, resolution=${width}x${height}`,
    );
    const startTime = Date.now();

    // 6. Run FFmpeg (5-minute timeout per job)
    await execFileAsync(getFFmpegBinary(), ffmpegArgs, {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB stderr buffer
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[VideoExport] FFmpeg completed in ${elapsed}s`);

    // 7. Read output — slice to get a plain ArrayBuffer (avoids SharedArrayBuffer typing issues)
    const buf = await fs.readFile(outputPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch (error) {
    // Classify errors so the user gets an actionable message instead of raw FFmpeg stderr
    const msg = String(error);
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
      throw new Error('影片合成逾時。建議：減少 PDF 頁數，或改用 720p 解析度。');
    }
    if (msg.includes('ENOMEM') || msg.includes('out of memory') || msg.includes('Cannot allocate')) {
      throw new Error('伺服器記憶體不足，請稍後再試。');
    }
    if (msg.includes('Invalid data found') || msg.includes('does not contain')) {
      throw new Error('音訊格式無法辨識。請使用 WAV、MP3、M4A 或 AAC 格式。');
    }
    throw new Error(`影片合成失敗：${msg.slice(0, 200)}`);
  } finally {
    activeExports--;
    // Always clean up temp directory
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
