import { describe, it, expect } from 'vitest';
import {
  serializeSrtWithSlideTags,
  parseSrtWithSlideTags,
  repairSrtEntries,
  srtEntriesToText,
  adjustSrtTimes,
  buildFallbackSrtEntriesFromLyrics,
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

// ── buildFallbackSrtEntriesFromLyrics ─────────────────────────────────────────
//
// Regression coverage for the shared PREAMBLE_LINE_RE filter added when the
// podcast AUDIO PROFILE preamble landed. The podcast-oriented filter strips
// lines like `Style:` / `Accent:` / `Pacing:` / `# SCENE`, which is correct for
// podcast scripts but could in principle drop legitimate lyric lines that
// happen to start with the same tokens. These tests pin down what is and isn't
// allowed to slip through.

function lyricsBlock(start: string, end: string, ...lines: string[]): string {
  return `[${start} - ${end}]\n${lines.join('\n')}`;
}

describe('buildFallbackSrtEntriesFromLyrics', () => {
  it('keeps ordinary lyric lines intact', () => {
    const lyrics = lyricsBlock(
      '0:00',
      '0:05',
      '月光灑落窗台',
      '我的心在輕輕搖擺',
      '愛是流星劃過夜空',
    );
    const entries = buildFallbackSrtEntriesFromLyrics(lyrics);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toContain('月光灑落窗台');
    expect(entries[0].text).toContain('我的心在輕輕搖擺');
    expect(entries[0].text).toContain('愛是流星劃過夜空');
  });

  it('does not drop lyric lines that contain Style/Accent/Pacing as substrings', () => {
    // These are legitimate lyrics that happen to include the tokens elsewhere;
    // the PREAMBLE_LINE_RE only matches `^Style:` so these must survive.
    const lyrics = lyricsBlock(
      '0:00',
      '0:05',
      'Your style is bright',
      'Old school accent still burns',
      'No pacing for the heart',
    );
    const entries = buildFallbackSrtEntriesFromLyrics(lyrics);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toContain('Your style is bright');
    expect(entries[0].text).toContain('Old school accent still burns');
    expect(entries[0].text).toContain('No pacing for the heart');
  });

  it('still strips legacy podcast preamble lines that leak in (defense-in-depth)', () => {
    const lyrics = lyricsBlock(
      '0:00',
      '0:05',
      '風格: Pop',
      '# AUDIO PROFILE',
      '## Speaker1: 主持人',
      'Style: 活潑',
      'Accent: 台灣口音',
      'Pacing: 輕快',
      '# SCENE',
      '真正的歌詞內容',
      '# SAMPLE CONTEXT',
      '投影片 1：標題',
      '另一段歌詞',
    );
    const entries = buildFallbackSrtEntriesFromLyrics(lyrics);
    expect(entries).toHaveLength(1);
    const text = entries[0].text;
    expect(text).toContain('真正的歌詞內容');
    expect(text).toContain('另一段歌詞');
    // These podcast-preamble lines should be gone.
    expect(text).not.toMatch(/^風格:/m);
    expect(text).not.toMatch(/^# AUDIO PROFILE/m);
    expect(text).not.toMatch(/^## Speaker1/m);
    expect(text).not.toMatch(/^Style:/m);
    expect(text).not.toMatch(/^Accent:/m);
    expect(text).not.toMatch(/^Pacing:/m);
    expect(text).not.toMatch(/^# SCENE/m);
    expect(text).not.toMatch(/^# SAMPLE CONTEXT/m);
    expect(text).not.toMatch(/^投影片\s*\d/m);
  });

  it('still strips song header metadata (歌曲名稱:/總時長:/節奏:/關鍵元素:)', () => {
    const lyrics = lyricsBlock(
      '0:00',
      '0:05',
      '歌曲名稱：夜行',
      '總時長：3:20',
      '節奏：Mid-tempo',
      '關鍵元素：Synth, Bass',
      '核心歌詞',
    );
    const entries = buildFallbackSrtEntriesFromLyrics(lyrics);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('核心歌詞');
  });

  it('produces no entry when only preamble/metadata lines are present', () => {
    const lyrics = lyricsBlock(
      '0:00',
      '0:05',
      '# AUDIO PROFILE',
      'Style: 活潑',
      '歌曲名稱：空',
    );
    const entries = buildFallbackSrtEntriesFromLyrics(lyrics);
    expect(entries).toHaveLength(0);
  });
});
