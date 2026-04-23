import type { SrtEntry, SrtSlideCue } from './types';
import { PREAMBLE_LINE_RE } from './scriptFormat';

export interface SrtValidationResult {
  valid: boolean;
  issues: string[];
}

const ROUNDING_PRECISION = 1000;
const MIN_ENTRY_DURATION = 0.25;
const EPSILON = 1 / ROUNDING_PRECISION;

function stripCodeFence(raw: string): string {
  return raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function normalizeText(text: string): string {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function toSrtTimestamp(totalSec: number): string {
  const safe = Math.max(0, totalSec);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function parseClock(value: string): number {
  const [mm, ss] = value.split(':').map(Number);
  return (mm || 0) * 60 + (ss || 0);
}

function parseTimeValue(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return NaN;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function roundToMillis(value: number): number {
  return Math.round(value * ROUNDING_PRECISION) / ROUNDING_PRECISION;
}

export function parseMusicSrtJson(raw: string): SrtEntry[] {
  const cleaned = stripCodeFence(raw);
  if (!cleaned) return [];

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item, index) => ({
      id: Number.isFinite(parseTimeValue(item?.id)) ? Math.trunc(parseTimeValue(item?.id)) : index + 1,
      start: parseTimeValue(item?.start),
      end: parseTimeValue(item?.end),
      text: typeof item?.text === 'string' ? item.text : '',
    }));
  } catch {
    return [];
  }
}

export function validateSrtEntries(entries: SrtEntry[]): SrtValidationResult {
  const issues: string[] = [];
  let previousEnd = -1;

  entries.forEach((entry, index) => {
    if (!Number.isFinite(entry.start) || !Number.isFinite(entry.end)) {
      issues.push(`Entry ${index + 1} has invalid numeric timestamps.`);
    }
    if (entry.start + EPSILON >= entry.end) {
      issues.push(`Entry ${index + 1} start must be smaller than end.`);
    }
    if (!normalizeText(entry.text)) {
      issues.push(`Entry ${index + 1} has empty text.`);
    }
    if (entry.start + EPSILON < previousEnd) {
      issues.push(`Entry ${index + 1} overlaps or goes backwards.`);
    }
    previousEnd = Math.max(previousEnd, entry.end);
  });

  return { valid: issues.length === 0, issues };
}

export function repairSrtEntries(entries: SrtEntry[]): SrtEntry[] {
  const cleaned = entries
    .map((entry, index) => ({
      id: index + 1,
      start: Number.isFinite(entry.start) ? Math.max(0, entry.start) : 0,
      end: Number.isFinite(entry.end) ? Math.max(0, entry.end) : 0,
      text: normalizeText(entry.text),
    }))
    .filter(entry => entry.text);

  cleaned.sort((a, b) => a.start - b.start || a.end - b.end);

  for (let i = 0; i < cleaned.length; i++) {
    const entry = cleaned[i];
    if (i > 0 && entry.start < cleaned[i - 1].end) {
      entry.start = cleaned[i - 1].end;
    }
    if (entry.end <= entry.start) {
      entry.end = entry.start + MIN_ENTRY_DURATION;
    }
    entry.id = i + 1;
    entry.start = roundToMillis(entry.start);
    entry.end = roundToMillis(entry.end);

    // Guard against rounding collisions that can invalidate otherwise-correct entries.
    if (i > 0 && entry.start < cleaned[i - 1].end) {
      entry.start = cleaned[i - 1].end;
    }
    if (entry.end <= entry.start) {
      entry.end = roundToMillis(entry.start + MIN_ENTRY_DURATION);
    }
  }

  return cleaned;
}

export function srtEntriesToText(entries: SrtEntry[]): string {
  return entries
    .map(entry => `${entry.id}\n${toSrtTimestamp(entry.start)} --> ${toSrtTimestamp(entry.end)}\n${entry.text}`)
    .join('\n\n')
    .trim();
}

export function buildFallbackSrtEntriesFromLyrics(lyrics: string): SrtEntry[] {
  const sectionRegex = /\[(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\][^\n]*\n([\s\S]*?)(?=\n\[\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\]|\s*$)/g;
  const entries: SrtEntry[] = [];
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(lyrics)) !== null) {
    const start = parseClock(match[1]);
    const end = parseClock(match[2]);
    const text = match[3]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line)
      .filter(line => !/^\[(slide|verse|chorus|bridge|outro|intro)/i.test(line))
      // Podcast-style preamble markers (風格: / # AUDIO PROFILE / Style: / …)
      // and 投影片 markers — defense-in-depth in case podcast script fragments
      // leak into lyrics fallback.
      .filter(line => !PREAMBLE_LINE_RE.test(line))
      // Lyrics-specific metadata (song header fields).
      .filter(line => !line.startsWith('歌曲名稱：'))
      .filter(line => !line.startsWith('總時長：'))
      .filter(line => !line.startsWith('節奏：'))
      .filter(line => !line.startsWith('關鍵元素：'))
      .join('\n')
      .trim();

    if (!text || end <= start) continue;

    entries.push({
      id: entries.length + 1,
      start,
      end,
      text,
    });
  }

  return repairSrtEntries(entries);
}

function srtTimeToMs(t: string): number {
  const m = t.trim().match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!m) throw new Error(`無效時間格式: ${t}`);
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ss = parseInt(m[3], 10);
  const ms = parseInt(m[4], 10);
  return ((hh * 60 + mm) * 60 + ss) * 1000 + ms;
}

function msToSrtTime(ms: number): string {
  ms = Math.max(0, Math.floor(ms));
  const hh = Math.floor(ms / 3600000);
  ms %= 3600000;
  const mm = Math.floor(ms / 60000);
  ms %= 60000;
  const ss = Math.floor(ms / 1000);
  ms %= 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function serializeSrtWithSlideTags(entries: SrtEntry[], slideCues: SrtSlideCue[]): string {
  const cueMap = new Map<number, number>();
  for (const cue of slideCues) {
    cueMap.set(cue.srtId, cue.slideIndex);
  }

  return entries
    .map(entry => {
      const slideIndex = cueMap.get(entry.id);
      const indexLine = slideIndex !== undefined
        ? `${entry.id} [slide-${slideIndex}]`
        : `${entry.id}`;
      return `${indexLine}\n${toSrtTimestamp(entry.start)} --> ${toSrtTimestamp(entry.end)}\n${entry.text}`;
    })
    .join('\n\n')
    .trim();
}

export function parseSrtWithSlideTags(srtText: string): { entries: SrtEntry[]; slideCues: SrtSlideCue[] } {
  const blocks = srtText.trim().split(/\n\n+/);
  const entries: SrtEntry[] = [];
  const slideCues: SrtSlideCue[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const indexLine = lines[0].trim();
    const timingLine = lines[1].trim();
    const textLines = lines.slice(2).join('\n').trim();

    const slideTagMatch = indexLine.match(/^(\d+)\s+\[slide-(\d+)\]/i);
    const plainMatch = indexLine.match(/^(\d+)$/);

    let id: number;
    if (slideTagMatch) {
      id = parseInt(slideTagMatch[1], 10);
      slideCues.push({ srtId: id, slideIndex: parseInt(slideTagMatch[2], 10) });
    } else if (plainMatch) {
      id = parseInt(plainMatch[1], 10);
    } else {
      continue;
    }

    const timingMatch = timingLine.match(/^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})$/);
    if (!timingMatch) continue;

    try {
      const start = srtTimeToMs(timingMatch[1]) / 1000;
      const end = srtTimeToMs(timingMatch[2]) / 1000;
      if (!textLines) continue;
      entries.push({ id, start, end, text: textLines });
    } catch {
      continue;
    }
  }

  return { entries, slideCues };
}

export function adjustSrtTimes(srtText: string, offsetSeconds: number): string {
  const offsetMs = Math.round(offsetSeconds * 1000);
  if (offsetMs === 0) return srtText;

  const lines = srtText.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    if (line.includes("-->")) {
      const parts = line.split("-->").map(x => x.trim());
      if (parts.length === 2) {
        try {
          const startMs = srtTimeToMs(parts[0]);
          const endMs = srtTimeToMs(parts[1]);

          // 第一筆 00:00:00,000 不動
          const newStartMs = startMs === 0 ? startMs : Math.max(0, startMs + offsetMs);
          const newEndMs = Math.max(0, endMs + offsetMs);

          result.push(`${msToSrtTime(newStartMs)} --> ${msToSrtTime(newEndMs)}`);
        } catch {
          result.push(line);
        }
      } else {
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

