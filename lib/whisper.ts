import type { SrtEntry } from './types';
import { repairSrtEntries, srtEntriesToText } from './srt';

const DEFAULT_WHISPER_URL = 'https://portal.genai.nchc.org.tw/api/v1/audio/transcriptions';
const DEFAULT_WHISPER_MODEL = 'whisper-Breeze-ASR-25';

interface WhisperSegment {
  id?: number;
  start?: number;
  end?: number;
  text?: string;
}

interface WhisperResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: WhisperSegment[];
}

export interface WhisperTranscriptionResult {
  srtEntries: SrtEntry[];
  srt: string;
  text: string;
  language?: string;
  duration?: number;
}

export function isWhisperConfigured(): boolean {
  return Boolean(
    process.env.NCHC_WHISPER_API_KEY &&
    process.env.NCHC_WHISPER_URL &&
    process.env.NCHC_WHISPER_MODEL
  );
}

function parseNumeric(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function guessFileName(mimeType: string): string {
  if (mimeType.includes('wav')) return 'audio.wav';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'audio.mp3';
  if (mimeType.includes('mp4')) return 'audio.m4a';
  return 'audio.bin';
}

function splitTextToEntries(text: string, duration?: number): SrtEntry[] {
  const lines = text
    .split(/[\r\n]+/)
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const safeDuration = typeof duration === 'number' && duration > 0 ? duration : lines.length * 3;
  const perLine = safeDuration / lines.length;

  return lines.map((line, index) => ({
    id: index + 1,
    start: index * perLine,
    end: index === lines.length - 1 ? safeDuration : (index + 1) * perLine,
    text: line,
  }));
}

export async function transcribeAudioWithWhisper(params: {
  audioBase64: string;
  mimeType?: string;
  language?: string;
}): Promise<WhisperTranscriptionResult> {
  const apiKey = process.env.NCHC_WHISPER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing NCHC_WHISPER_API_KEY');
  }

  const url = process.env.NCHC_WHISPER_URL || DEFAULT_WHISPER_URL;
  const model = process.env.NCHC_WHISPER_MODEL || DEFAULT_WHISPER_MODEL;
  const mimeType = params.mimeType && params.mimeType.startsWith('audio/') ? params.mimeType : 'audio/mpeg';
  const audioBytes = Buffer.from(params.audioBase64, 'base64');

  const form = new FormData();
  form.append('file', new Blob([audioBytes], { type: mimeType }), guessFileName(mimeType));
  form.append('model', model);
  form.append('language', params.language || 'zh');
  form.append('response_format', 'json');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`Whisper API error: ${payloadText}`);
  }

  let payload: WhisperResponse;
  try {
    payload = JSON.parse(payloadText) as WhisperResponse;
  } catch {
    throw new Error('Whisper API returned invalid JSON');
  }

  const segmentEntries = Array.isArray(payload.segments)
    ? payload.segments.map((segment, index) => ({
      id: typeof segment.id === 'number' ? segment.id + 1 : index + 1,
      start: parseNumeric(segment.start),
      end: parseNumeric(segment.end),
      text: typeof segment.text === 'string' ? segment.text.trim() : '',
    }))
    : [];

  const srtEntries = repairSrtEntries(
    segmentEntries.length
      ? segmentEntries
      : splitTextToEntries(payload.text ?? '', payload.duration)
  );

  return {
    srtEntries,
    srt: srtEntriesToText(srtEntries),
    text: typeof payload.text === 'string' ? payload.text : srtEntries.map(entry => entry.text).join(' '),
    language: payload.language,
    duration: payload.duration,
  };
}
