import { describe, it, expect } from 'vitest';
import {
  serializeSrtWithSlideTags,
  parseSrtWithSlideTags,
  repairSrtEntries,
  srtEntriesToText,
  adjustSrtTimes,
} from '../lib/srt';
import type { SrtEntry, SrtSlideCue } from '../lib/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function entry(id: number, start: number, end: number, text: string): SrtEntry {
  return { id, start, end, text };
}

function cue(srtId: number, slideIndex: number): SrtSlideCue {
  return { srtId, slideIndex };
}

// ── serializeSrtWithSlideTags ─────────────────────────────────────────────────

describe('serializeSrtWithSlideTags', () => {
  it('emits [slide-N] only on tagged entries', () => {
    const entries = [entry(1, 0, 2, 'Hello'), entry(2, 2, 4, 'World'), entry(3, 4, 6, 'Bye')];
    const cues = [cue(1, 1), cue(3, 2)];
    const result = serializeSrtWithSlideTags(entries, cues);
    expect(result).toContain('1 [slide-1]');
    expect(result).toContain('3 [slide-2]');
    expect(result).not.toContain('2 [slide-');
  });

  it('leaves text body unchanged', () => {
    const entries = [entry(5, 18.5, 21.74, '首先看這張發展歷程圖')];
    const cues = [cue(5, 2)];
    const result = serializeSrtWithSlideTags(entries, cues);
    expect(result).toContain('5 [slide-2]');
    expect(result).toContain('首先看這張發展歷程圖');
  });

  it('handles empty cues — plain SRT', () => {
    const entries = [entry(1, 0, 1, 'test')];
    const result = serializeSrtWithSlideTags(entries, []);
    expect(result).toMatch(/^1\n/);
    expect(result).not.toContain('[slide-');
  });

  it('supports repeat slideIndex', () => {
    const entries = [entry(1, 0, 2, 'A'), entry(3, 5, 7, 'B')];
    const cues = [cue(1, 2), cue(3, 2)];
    const result = serializeSrtWithSlideTags(entries, cues);
    expect(result).toContain('1 [slide-2]');
    expect(result).toContain('3 [slide-2]');
  });
});

// ── parseSrtWithSlideTags ─────────────────────────────────────────────────────

describe('parseSrtWithSlideTags', () => {
  it('round-trips through serialize', () => {
    const entries = [
      entry(1, 0, 2, 'Hello'),
      entry(2, 2, 4, 'World'),
      entry(3, 4, 6, 'Bye'),
    ];
    const cues = [cue(1, 1), cue(3, 2)];
    const serialized = serializeSrtWithSlideTags(entries, cues);
    const { entries: parsed, slideCues: parsedCues } = parseSrtWithSlideTags(serialized);

    expect(parsed).toHaveLength(3);
    expect(parsedCues).toHaveLength(2);
    expect(parsedCues[0]).toEqual({ srtId: 1, slideIndex: 1 });
    expect(parsedCues[1]).toEqual({ srtId: 3, slideIndex: 2 });
  });

  it('parses plain SRT with no slide tags', () => {
    const plain = '1\n00:00:00,000 --> 00:00:02,000\nHello\n\n2\n00:00:02,000 --> 00:00:04,000\nWorld';
    const { entries: parsed, slideCues: parsedCues } = parseSrtWithSlideTags(plain);
    expect(parsed).toHaveLength(2);
    expect(parsedCues).toHaveLength(0);
  });

  it('handles slide-back (jump) correctly', () => {
    const text = '1 [slide-2]\n00:00:00,000 --> 00:00:02,000\nA\n\n2 [slide-1]\n00:00:02,000 --> 00:00:04,000\nB';
    const { slideCues } = parseSrtWithSlideTags(text);
    expect(slideCues).toEqual([
      { srtId: 1, slideIndex: 2 },
      { srtId: 2, slideIndex: 1 },
    ]);
  });
});

// ── adjustSrtTimes ────────────────────────────────────────────────────────────

describe('adjustSrtTimes', () => {
  it('preserves [slide-N] tags on index lines', () => {
    const entries = [entry(1, 0, 2, 'test'), entry(2, 2, 4, 'foo')];
    const cues = [cue(1, 1), cue(2, 2)];
    const srt = serializeSrtWithSlideTags(entries, cues);
    const adjusted = adjustSrtTimes(srt, 1);
    expect(adjusted).toContain('1 [slide-1]');
    expect(adjusted).toContain('2 [slide-2]');
  });

  it('shifts timing lines by offset', () => {
    const plain = '1\n00:00:02,000 --> 00:00:04,000\nHello';
    const adjusted = adjustSrtTimes(plain, 3);
    expect(adjusted).toContain('00:00:05,000 --> 00:00:07,000');
  });

  it('zero offset returns same string', () => {
    const plain = '1\n00:00:00,000 --> 00:00:02,000\nHello';
    expect(adjustSrtTimes(plain, 0)).toBe(plain);
  });
});

// ── repairSrtEntries ──────────────────────────────────────────────────────────

describe('repairSrtEntries', () => {
  it('removes entries with empty text', () => {
    const result = repairSrtEntries([entry(1, 0, 2, '  '), entry(2, 2, 4, 'keep')]);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('keep');
  });

  it('fixes overlapping entries', () => {
    const result = repairSrtEntries([entry(1, 0, 5, 'A'), entry(2, 3, 7, 'B')]);
    expect(result[1].start).toBeGreaterThanOrEqual(result[0].end);
  });

  it('reassigns ids sequentially', () => {
    const result = repairSrtEntries([entry(99, 0, 1, 'A'), entry(5, 1, 2, 'B')]);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
  });
});
