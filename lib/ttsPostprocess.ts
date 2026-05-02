// TTS chunk audio postprocessing (plan: PLAN_TTS_CHUNK_AUDIO_POSTPROCESSING.md).
//
// Runs on the server after chunked Gemini TTS generation, before the merged WAV
// is returned. Pipeline:
//
//   raw PCM chunks
//     -> temp WAV per chunk
//     -> (Phase B) per-chunk loudness analysis + conservative gain match
//     -> (Phase C) boundary merge via acrossfade (fallback: concat + short gap)
//     -> (Phase A) whole-file loudnorm to podcast target (-16 LUFS)
//     -> final WAV bytes
//
// Single-chunk mode does NOT call this module. It is only invoked when the
// chunker produced >= 2 chunks AND TTS_CHUNK_POSTPROCESSING_ENABLED=true.

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

import {
  TTS_TARGET_LUFS,
  TTS_TRUE_PEAK,
  TTS_LRA,
  TTS_GAIN_MATCH_THRESHOLD_DB,
  TTS_GAIN_MATCH_MAX_DB,
  TTS_SLIDE_FADE_OUT_MS,
  TTS_SLIDE_SILENCE_MS,
  TTS_SLIDE_FADE_IN_MS,
  TTS_FALLBACK_GAP_MS,
} from './constants';

// Parse a non-negative integer env var. Returns the fallback if the env is
// missing, blank, NaN, or negative.
export function readMsEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

const execFileAsync = promisify(execFile);

// Keep in sync with normalize-podcast-audio route so Windows dev and Docker
// resolve the same ffmpeg binary.
export function getFFmpegBinary(): string {
  const bin = (process.env.VIDEO_FFMPEG_BIN ?? '').trim();
  if (bin) return path.join(bin, 'ffmpeg');
  return 'ffmpeg';
}

export function getTempDir(): string {
  return process.platform === 'win32'
    ? path.join(os.tmpdir(), 'podcast-tts-postprocess')
    : '/tmp/podcast-tts-postprocess';
}

// Standalone PCM -> WAV wrapper. Duplicates the copy in generate-podcast/route
// intentionally so this module has no route-level coupling and can be unit
// tested in isolation.
export function pcmToWav(pcmData: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer).set(pcmData, 44);
  return new Uint8Array(buffer);
}

// Parse the last `I:   -xx.x LUFS` line from ffmpeg ebur128 stderr output.
// ebur128 prints per-frame lines and a `Summary:` block at the end; the final
// `I:` in the stream is the integrated loudness.
export function parseIntegratedLoudness(stderr: string): number | null {
  const re = /I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g;
  let last: number | null = null;
  for (const m of stderr.matchAll(re)) {
    const v = Number.parseFloat(m[1]);
    if (Number.isFinite(v)) last = v;
  }
  return last;
}

// Median of a finite number list. Returns null for empty input.
export function median(values: number[]): number | null {
  const finite = values.filter((v): v is number => Number.isFinite(v));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Decide the gain (dB) to apply so `chunkLufs` moves toward `targetLufs`,
// respecting threshold (skip tiny corrections) and cap (safe adjustment range).
export function computeGainDb(
  chunkLufs: number,
  targetLufs: number,
  thresholdDb: number = TTS_GAIN_MATCH_THRESHOLD_DB,
  maxDb: number = TTS_GAIN_MATCH_MAX_DB,
): number {
  const delta = targetLufs - chunkLufs;
  if (!Number.isFinite(delta)) return 0;
  if (Math.abs(delta) < thresholdDb) return 0;
  if (delta > maxDb) return maxDb;
  if (delta < -maxDb) return -maxDb;
  return Number.parseFloat(delta.toFixed(2));
}

export interface PostprocessOptions {
  sampleRate: number;
  targetLufs?: number;
  truePeak?: number;
  lra?: number;
  /** Slide-boundary transition: chunk tail fade-out duration. */
  slideFadeOutMs?: number;
  /** Slide-boundary transition: silence between chunks. */
  slideSilenceMs?: number;
  /** Slide-boundary transition: chunk head fade-in duration. */
  slideFadeInMs?: number;
}

export type MergeStrategy = 'fade-silence-fade' | 'concat-with-gap';

export interface PostprocessMetrics {
  chunkLufs: (number | null)[];
  chunkGainAppliedDb: number[];
  mergeStrategy: MergeStrategy;
  finalLoudnormApplied: boolean;
  analyzeMs: number;
  gainMs: number;
  mergeMs: number;
  loudnormMs: number;
}

export interface PostprocessResult {
  wav: Uint8Array;
  metrics: PostprocessMetrics;
}

// Run a single ffmpeg invocation and return its stderr (where ebur128 / loudnorm
// diagnostics live). ffmpeg always exits 0 on analyze-and-discard pipelines,
// but we still surface errors when the process fails.
async function runFFmpeg(
  args: string[],
  timeoutMs = 120_000,
): Promise<{ stdout: string; stderr: string }> {
  const bin = getFFmpegBinary();
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' };
  } catch (err: unknown) {
    // execFile throws when exit code != 0. Re-throw with stderr included so
    // the caller can surface a useful message.
    if (err && typeof err === 'object' && 'stderr' in err) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(
        `ffmpeg failed: ${e.message ?? ''}\nstderr:\n${(e.stderr ?? '').slice(-2000)}`,
      );
    }
    throw err;
  }
}

async function analyzeLoudness(wavPath: string): Promise<number | null> {
  // ebur128 runs in null-sink mode so no output file is produced.
  const { stderr } = await runFFmpeg([
    '-nostdin',
    '-hide_banner',
    '-i', wavPath,
    '-af', 'ebur128',
    '-f', 'null',
    '-',
  ]);
  return parseIntegratedLoudness(stderr);
}

async function applyGain(
  inputPath: string,
  outputPath: string,
  gainDb: number,
): Promise<void> {
  await runFFmpeg([
    '-nostdin',
    '-hide_banner',
    '-y',
    '-i', inputPath,
    '-af', `volume=${gainDb.toFixed(2)}dB`,
    '-c:a', 'pcm_s16le',
    outputPath,
  ]);
}

/**
 * Estimate a chunk's duration in seconds from its raw Int16 LE PCM byte length.
 * Assumes 1 channel, 16-bit samples, shared sampleRate — which is guaranteed
 * because we write the WAV files ourselves with `pcmToWav`.
 */
export function pcmDurationSec(pcmByteLength: number, sampleRate: number): number {
  const samples = Math.floor(pcmByteLength / 2); // 2 bytes per Int16 sample
  return samples / sampleRate;
}

/**
 * Build the fade-out + silence + fade-in transition filter graph.
 *
 * For each chunk:
 *   - first chunk: only fade-out at its tail
 *   - middle chunks: fade-in at head, fade-out at tail
 *   - last chunk: only fade-in at head
 *
 * Between every consecutive chunk pair we insert a silent aevalsrc segment.
 * All segments are concatenated in order.
 *
 * @param chunkDurationsSec per-chunk audio duration (seconds) — used to place
 *                          fade-out `st=` at duration - fadeOut.
 */
export function buildFadeTransitionFilter(
  chunkDurationsSec: number[],
  opts: { fadeOutMs: number; silenceMs: number; fadeInMs: number; sampleRate: number },
): string {
  const n = chunkDurationsSec.length;
  if (n < 2) return '';

  const fadeOutSec = opts.fadeOutMs / 1000;
  const fadeInSec  = opts.fadeInMs  / 1000;
  const silenceSec = opts.silenceMs / 1000;

  const parts: string[] = [];
  const segments: string[] = [];

  for (let i = 0; i < n; i++) {
    const duration = chunkDurationsSec[i];
    const isFirst = i === 0;
    const isLast  = i === n - 1;

    // Fade-out start = chunk duration - fadeOut. Guard against negative/zero
    // when a chunk is shorter than fadeOut (unlikely but possible).
    const foDur = Math.min(fadeOutSec, Math.max(duration - 0.001, 0));
    const fiDur = Math.min(fadeInSec,  Math.max(duration - 0.001, 0));
    const foStart = Math.max(duration - foDur, 0);

    const filters: string[] = [];
    if (!isFirst && fiDur > 0) {
      filters.push(`afade=t=in:st=0:d=${fiDur.toFixed(3)}`);
    }
    if (!isLast && foDur > 0) {
      filters.push(`afade=t=out:st=${foStart.toFixed(3)}:d=${foDur.toFixed(3)}`);
    }

    const label = `[a${i}]`;
    if (filters.length > 0) {
      parts.push(`[${i}:a]${filters.join(',')}${label}`);
      segments.push(label);
    } else {
      // No fade needed (single chunk edge case guarded above; keep defensive).
      segments.push(`[${i}:a]`);
    }

    if (!isLast && silenceSec > 0) {
      const silenceLabel = `[s${i}]`;
      parts.push(
        `aevalsrc=0:d=${silenceSec.toFixed(3)}:s=${opts.sampleRate}${silenceLabel}`,
      );
      segments.push(silenceLabel);
    }
  }

  parts.push(`${segments.join('')}concat=n=${segments.length}:v=0:a=1[out]`);
  return parts.join(';');
}

// Plain concat with a fixed silence gap. Used as a fallback when the fade
// transition filter fails (e.g. a chunk is shorter than fadeOut + fadeIn).
export function buildConcatWithGapFilter(
  inputCount: number,
  gapMs: number,
  sampleRate: number,
): string {
  if (inputCount < 2) return '';
  const gapSec = gapMs / 1000;
  const parts: string[] = [];
  const segments: string[] = [];
  for (let i = 0; i < inputCount; i++) {
    segments.push(`[${i}:a]`);
    if (i < inputCount - 1) {
      parts.push(
        `aevalsrc=0:d=${gapSec.toFixed(3)}:s=${sampleRate}[g${i}]`,
      );
      segments.push(`[g${i}]`);
    }
  }
  parts.push(`${segments.join('')}concat=n=${segments.length}:v=0:a=1[out]`);
  return parts.join(';');
}

async function mergeWavs(
  inputPaths: string[],
  outputPath: string,
  opts: {
    sampleRate: number;
    chunkDurationsSec: number[];
    fadeOutMs: number;
    silenceMs: number;
    fadeInMs: number;
    fallbackGapMs: number;
  },
): Promise<{ strategy: MergeStrategy }> {
  const inputArgs = inputPaths.flatMap(p => ['-i', p]);

  try {
    const filter = buildFadeTransitionFilter(opts.chunkDurationsSec, {
      fadeOutMs: opts.fadeOutMs,
      silenceMs: opts.silenceMs,
      fadeInMs:  opts.fadeInMs,
      sampleRate: opts.sampleRate,
    });
    await runFFmpeg([
      '-nostdin',
      '-hide_banner',
      '-y',
      ...inputArgs,
      '-filter_complex', filter,
      '-map', '[out]',
      '-c:a', 'pcm_s16le',
      outputPath,
    ]);
    return { strategy: 'fade-silence-fade' };
  } catch (err) {
    console.warn(
      `[tts-postprocess] fade transition failed, falling back to concat gap=${opts.fallbackGapMs}ms: ${err instanceof Error ? err.message : String(err)}`,
    );
    const filter = buildConcatWithGapFilter(
      inputPaths.length,
      opts.fallbackGapMs,
      opts.sampleRate,
    );
    await runFFmpeg([
      '-nostdin',
      '-hide_banner',
      '-y',
      ...inputArgs,
      '-filter_complex', filter,
      '-map', '[out]',
      '-c:a', 'pcm_s16le',
      outputPath,
    ]);
    return { strategy: 'concat-with-gap' };
  }
}

async function finalLoudnorm(
  inputPath: string,
  outputPath: string,
  opts: { targetLufs: number; truePeak: number; lra: number },
): Promise<void> {
  await runFFmpeg([
    '-nostdin',
    '-hide_banner',
    '-y',
    '-i', inputPath,
    '-af',
    `loudnorm=I=${opts.targetLufs}:TP=${opts.truePeak}:LRA=${opts.lra}`,
    '-c:a', 'pcm_s16le',
    outputPath,
  ]);
}

/**
 * Main entry point. Takes an array of raw Int16 LE PCM chunks (same sample rate
 * for all chunks) and returns a single WAV with loudness-matched boundaries
 * and final loudnorm applied.
 *
 * Throws if ffmpeg is unavailable or processing fails. The caller should
 * treat postprocessing failures as a 502 (per plan §12) rather than silently
 * returning a lower-quality concat result — quiet fallback makes quality bugs
 * harder to diagnose during early rollout.
 */
export async function postprocessChunks(
  pcmChunks: Uint8Array[],
  options: PostprocessOptions,
): Promise<PostprocessResult> {
  if (pcmChunks.length < 2) {
    throw new Error('postprocessChunks requires at least 2 chunks');
  }

  const targetLufs   = options.targetLufs   ?? TTS_TARGET_LUFS;
  const truePeak     = options.truePeak     ?? TTS_TRUE_PEAK;
  const lra          = options.lra          ?? TTS_LRA;
  // Slide transition params: explicit option > env var > constant default.
  const fadeOutMs    = options.slideFadeOutMs ?? readMsEnv('TTS_SLIDE_FADE_OUT_MS', TTS_SLIDE_FADE_OUT_MS);
  const silenceMs    = options.slideSilenceMs ?? readMsEnv('TTS_SLIDE_SILENCE_MS', TTS_SLIDE_SILENCE_MS);
  const fadeInMs     = options.slideFadeInMs  ?? readMsEnv('TTS_SLIDE_FADE_IN_MS',  TTS_SLIDE_FADE_IN_MS);
  // Reserved tuning knobs; not user-visible via options today.
  const fallbackGap  = TTS_FALLBACK_GAP_MS;

  const tmpDir = getTempDir();
  await fs.mkdir(tmpDir, { recursive: true });

  const sessionId = crypto.randomUUID();
  const tempFiles: string[] = [];

  // Stage paths: {sessionId}-in-N.wav, {sessionId}-gain-N.wav,
  //              {sessionId}-merged.wav, {sessionId}-final.wav
  const chunkWavPaths    = pcmChunks.map((_, i) => path.join(tmpDir, `${sessionId}-in-${i}.wav`));
  const gainedWavPaths   = pcmChunks.map((_, i) => path.join(tmpDir, `${sessionId}-gain-${i}.wav`));
  const mergedPath       = path.join(tmpDir, `${sessionId}-merged.wav`);
  const finalPath        = path.join(tmpDir, `${sessionId}-final.wav`);
  tempFiles.push(...chunkWavPaths, ...gainedWavPaths, mergedPath, finalPath);

  const metrics: PostprocessMetrics = {
    chunkLufs: [],
    chunkGainAppliedDb: [],
    mergeStrategy: 'fade-silence-fade',
    finalLoudnormApplied: false,
    analyzeMs: 0,
    gainMs: 0,
    mergeMs: 0,
    loudnormMs: 0,
  };

  try {
    // 1. Write raw PCM chunks as WAV temp files.
    await Promise.all(
      pcmChunks.map((pcm, i) =>
        fs.writeFile(chunkWavPaths[i], pcmToWav(pcm, options.sampleRate)),
      ),
    );

    // 2. Phase B — per-chunk loudness analysis.
    const analyzeStart = Date.now();
    const lufsResults = await Promise.all(chunkWavPaths.map(p => analyzeLoudness(p).catch(() => null)));
    metrics.chunkLufs = lufsResults;
    metrics.analyzeMs = Date.now() - analyzeStart;

    const medianLufs = median(lufsResults.filter((v): v is number => v !== null));

    // 3. Phase B — conservative gain match against median.
    const gainStart = Date.now();
    const gainTasks: Promise<void>[] = [];
    const gainsApplied: number[] = new Array(pcmChunks.length).fill(0);
    for (let i = 0; i < pcmChunks.length; i++) {
      const chunkLufs = lufsResults[i];
      const gainDb = medianLufs !== null && chunkLufs !== null
        ? computeGainDb(chunkLufs, medianLufs)
        : 0;
      gainsApplied[i] = gainDb;
      if (gainDb === 0) {
        // No correction needed — copy original WAV to gained path so merge
        // sees a consistent filename scheme.
        gainTasks.push(fs.copyFile(chunkWavPaths[i], gainedWavPaths[i]));
      } else {
        gainTasks.push(applyGain(chunkWavPaths[i], gainedWavPaths[i], gainDb));
      }
    }
    await Promise.all(gainTasks);
    metrics.chunkGainAppliedDb = gainsApplied;
    metrics.gainMs = Date.now() - gainStart;

    // 4. Phase C — slide transition boundary merge.
    //    Duration per chunk is computed from the original PCM bytes (same
    //    sampleRate, Int16 LE mono). The gained WAVs have the same audio
    //    length (gain = volume scale only), so the fade-out `st=` timestamp
    //    remains accurate.
    const mergeStart = Date.now();
    const chunkDurationsSec = pcmChunks.map(pcm => pcmDurationSec(pcm.byteLength, options.sampleRate));
    const mergeResult = await mergeWavs(gainedWavPaths, mergedPath, {
      sampleRate: options.sampleRate,
      chunkDurationsSec,
      fadeOutMs,
      silenceMs,
      fadeInMs,
      fallbackGapMs: fallbackGap,
    });
    metrics.mergeStrategy = mergeResult.strategy;
    metrics.mergeMs = Date.now() - mergeStart;

    // 5. Phase A — whole-file loudnorm to podcast target.
    const loudnormStart = Date.now();
    try {
      await finalLoudnorm(mergedPath, finalPath, { targetLufs, truePeak, lra });
      metrics.finalLoudnormApplied = true;
    } catch (err) {
      console.warn(
        `[tts-postprocess] loudnorm failed, returning merged WAV without normalization: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    metrics.loudnormMs = Date.now() - loudnormStart;

    const resultPath = metrics.finalLoudnormApplied ? finalPath : mergedPath;
    const wav = await fs.readFile(resultPath);
    return { wav: new Uint8Array(wav), metrics };
  } finally {
    await Promise.allSettled(tempFiles.map(p => fs.unlink(p).catch(() => {})));
  }
}
