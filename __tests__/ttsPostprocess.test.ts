import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import {
  parseIntegratedLoudness,
  median,
  computeGainDb,
  pcmToWav,
  getTempDir,
  getFFmpegBinary,
  pcmDurationSec,
  buildFadeTransitionFilter,
  buildConcatWithGapFilter,
  readMsEnv,
} from '@/lib/ttsPostprocess';
import {
  TTS_GAIN_MATCH_MAX_DB,
  TTS_GAIN_MATCH_THRESHOLD_DB,
} from '@/lib/constants';

describe('parseIntegratedLoudness', () => {
  it('returns null when no I: line is present', () => {
    expect(parseIntegratedLoudness('no loudness here')).toBeNull();
  });

  it('parses the final Summary I: value from ebur128 stderr', () => {
    const stderr = [
      '[Parsed_ebur128_0 @ 0x1] t: 1  TARGET:-23 LUFS    M: -18.5 S:-999.0     I: -19.2 LUFS       LRA:   0.0 LU',
      '[Parsed_ebur128_0 @ 0x1] Summary:',
      '',
      '  Integrated loudness:',
      '    I:         -18.7 LUFS',
      '    Threshold: -28.7 LUFS',
    ].join('\n');
    expect(parseIntegratedLoudness(stderr)).toBeCloseTo(-18.7, 2);
  });

  it('handles positive LUFS values', () => {
    expect(parseIntegratedLoudness('I: 0.5 LUFS')).toBeCloseTo(0.5, 2);
  });
});

describe('median', () => {
  it('returns null for empty', () => {
    expect(median([])).toBeNull();
  });

  it('returns middle for odd length', () => {
    expect(median([1, 5, 3])).toBe(3);
  });

  it('averages middle two for even length', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('ignores non-finite values', () => {
    expect(median([1, NaN, 3, Infinity, 5])).toBe(3);
  });
});

describe('computeGainDb', () => {
  it('returns 0 when delta is below threshold', () => {
    const delta = TTS_GAIN_MATCH_THRESHOLD_DB - 0.1;
    expect(computeGainDb(-16, -16 + delta)).toBe(0);
    expect(computeGainDb(-16, -16 - delta)).toBe(0);
  });

  it('returns the delta when within cap and above threshold', () => {
    expect(computeGainDb(-18, -16)).toBeCloseTo(2, 2); // delta = +2dB
    expect(computeGainDb(-14, -16)).toBeCloseTo(-2, 2);
  });

  it('clamps to +/- max cap', () => {
    expect(computeGainDb(-30, -16)).toBe(TTS_GAIN_MATCH_MAX_DB);
    expect(computeGainDb(0, -16)).toBe(-TTS_GAIN_MATCH_MAX_DB);
  });

  it('returns 0 for non-finite input', () => {
    expect(computeGainDb(NaN, -16)).toBe(0);
  });
});

describe('pcmToWav', () => {
  it('prepends a 44-byte RIFF/WAVE header', () => {
    const pcm = new Uint8Array(1000);
    const wav = pcmToWav(pcm, 24000);
    expect(wav.byteLength).toBe(1044);
    // "RIFF"
    expect(String.fromCharCode(wav[0], wav[1], wav[2], wav[3])).toBe('RIFF');
    // "WAVE"
    expect(String.fromCharCode(wav[8], wav[9], wav[10], wav[11])).toBe('WAVE');
  });

  it('writes sample rate into bytes 24-27 (little-endian)', () => {
    const wav = pcmToWav(new Uint8Array(0), 48000);
    const sr = wav[24] | (wav[25] << 8) | (wav[26] << 16) | (wav[27] << 24);
    expect(sr).toBe(48000);
  });
});

describe('getTempDir', () => {
  it('uses os tmpdir on win32, /tmp elsewhere', () => {
    const dir = getTempDir();
    if (process.platform === 'win32') {
      expect(dir).toBe(path.join(os.tmpdir(), 'podcast-tts-postprocess'));
    } else {
      expect(dir).toBe('/tmp/podcast-tts-postprocess');
    }
  });
});

describe('getFFmpegBinary', () => {
  it('returns "ffmpeg" when VIDEO_FFMPEG_BIN is not set', () => {
    const original = process.env.VIDEO_FFMPEG_BIN;
    delete process.env.VIDEO_FFMPEG_BIN;
    try {
      expect(getFFmpegBinary()).toBe('ffmpeg');
    } finally {
      if (original !== undefined) process.env.VIDEO_FFMPEG_BIN = original;
    }
  });

  it('joins VIDEO_FFMPEG_BIN with "ffmpeg" when set', () => {
    const original = process.env.VIDEO_FFMPEG_BIN;
    process.env.VIDEO_FFMPEG_BIN = '/opt/ffmpeg/bin';
    try {
      expect(getFFmpegBinary()).toBe(path.join('/opt/ffmpeg/bin', 'ffmpeg'));
    } finally {
      if (original === undefined) delete process.env.VIDEO_FFMPEG_BIN;
      else process.env.VIDEO_FFMPEG_BIN = original;
    }
  });
});

describe('pcmDurationSec', () => {
  it('converts Int16 LE byte length to seconds at 24kHz', () => {
    // 1 second @ 24000 samples/s @ 2 bytes/sample = 48000 bytes
    expect(pcmDurationSec(48000, 24000)).toBe(1);
    expect(pcmDurationSec(24000, 24000)).toBe(0.5);
    expect(pcmDurationSec(0, 24000)).toBe(0);
  });
});

describe('buildFadeTransitionFilter', () => {
  const OPTS = { fadeOutMs: 100, silenceMs: 500, fadeInMs: 80, sampleRate: 24000 };

  it('returns empty string when fewer than 2 chunks', () => {
    expect(buildFadeTransitionFilter([5], OPTS)).toBe('');
    expect(buildFadeTransitionFilter([], OPTS)).toBe('');
  });

  it('produces first-only-fadeout and last-only-fadein for 2 chunks', () => {
    const f = buildFadeTransitionFilter([3, 4], OPTS);
    // First chunk: only afade=t=out, starting at duration - 0.1 = 2.9
    expect(f).toContain('[0:a]afade=t=out:st=2.900:d=0.100[a0]');
    // Last chunk: only afade=t=in
    expect(f).toContain('[1:a]afade=t=in:st=0:d=0.080[a1]');
    // Silence segment between them
    expect(f).toContain('aevalsrc=0:d=0.500:s=24000[s0]');
    // Final concat order
    expect(f).toContain('[a0][s0][a1]concat=n=3:v=0:a=1[out]');
  });

  it('middle chunks get both fade-in and fade-out for 3 chunks', () => {
    const f = buildFadeTransitionFilter([2, 3, 4], OPTS);
    // Middle chunk (index 1): fade-in + fade-out on same chain
    expect(f).toContain('[1:a]afade=t=in:st=0:d=0.080,afade=t=out:st=2.900:d=0.100[a1]');
    expect(f).toContain('concat=n=5:v=0:a=1[out]');
  });

  it('chains 4 chunks with 3 silence segments', () => {
    const f = buildFadeTransitionFilter([2, 2, 2, 2], OPTS);
    // 4 audio + 3 silence = 7 segments
    expect(f).toContain('concat=n=7:v=0:a=1[out]');
    expect(f).toContain('[s0]');
    expect(f).toContain('[s1]');
    expect(f).toContain('[s2]');
  });

  it('clamps fade duration when chunk is shorter than fadeOut', () => {
    // chunk 0 is 0.05s but fadeOut is 0.1s → should clamp to chunk-0.001
    const f = buildFadeTransitionFilter([0.05, 1], OPTS);
    // duration 0.05 - 0.001 = 0.049
    expect(f).toContain('d=0.049');
  });

  it('omits silence segment when silenceMs=0', () => {
    const f = buildFadeTransitionFilter([2, 2], { ...OPTS, silenceMs: 0 });
    expect(f).not.toContain('aevalsrc');
    expect(f).toContain('concat=n=2:v=0:a=1[out]');
  });
});

describe('buildConcatWithGapFilter', () => {
  it('returns empty string for <2 inputs', () => {
    expect(buildConcatWithGapFilter(1, 60, 24000)).toBe('');
  });

  it('produces N audio + (N-1) silence segments concatenated', () => {
    const f = buildConcatWithGapFilter(3, 60, 24000);
    expect(f).toContain('aevalsrc=0:d=0.060:s=24000[g0]');
    expect(f).toContain('aevalsrc=0:d=0.060:s=24000[g1]');
    expect(f).toContain('[0:a][g0][1:a][g1][2:a]concat=n=5:v=0:a=1[out]');
  });
});

describe('readMsEnv', () => {
  const KEY = '__TEST_MS_ENV__';
  const restore = (original: string | undefined) => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  };

  it('returns fallback when env is unset', () => {
    const original = process.env[KEY];
    delete process.env[KEY];
    try { expect(readMsEnv(KEY, 500)).toBe(500); }
    finally { restore(original); }
  });

  it('returns fallback when env is blank', () => {
    const original = process.env[KEY];
    process.env[KEY] = '  ';
    try { expect(readMsEnv(KEY, 500)).toBe(500); }
    finally { restore(original); }
  });

  it('returns fallback when env is not a number', () => {
    const original = process.env[KEY];
    process.env[KEY] = 'abc';
    try { expect(readMsEnv(KEY, 500)).toBe(500); }
    finally { restore(original); }
  });

  it('returns fallback when env is negative', () => {
    const original = process.env[KEY];
    process.env[KEY] = '-10';
    try { expect(readMsEnv(KEY, 500)).toBe(500); }
    finally { restore(original); }
  });

  it('returns parsed int when env is a non-negative integer', () => {
    const original = process.env[KEY];
    process.env[KEY] = '250';
    try { expect(readMsEnv(KEY, 500)).toBe(250); }
    finally { restore(original); }
  });

  it('accepts 0 as a valid value', () => {
    const original = process.env[KEY];
    process.env[KEY] = '0';
    try { expect(readMsEnv(KEY, 500)).toBe(0); }
    finally { restore(original); }
  });
});
