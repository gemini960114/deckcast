import { describe, it, expect } from 'vitest';
import {
  buildSlideCueEvents,
  buildTimingsFromSlideCueEvents,
  buildSlideCuesFromVisualCueMatches,
  buildSlideCuesFromTransitionMatches,
  normalizeTimings,
} from '../lib/timing';
import type { SrtEntry, SrtSlideCue, VisualCueMatch, MusicTransitionMatch } from '../lib/types';

function entry(id: number, start: number, end: number, text = 'x'): SrtEntry {
  return { id, start, end, text };
}

function cue(srtId: number, slideIndex: number): SrtSlideCue {
  return { srtId, slideIndex };
}

// ── buildSlideCueEvents ───────────────────────────────────────────────────────

describe('buildSlideCueEvents', () => {
  it('maps cues to SRT start times', () => {
    const entries = [entry(1, 0, 2), entry(2, 3, 5), entry(3, 7, 9)];
    const cues = [cue(1, 1), cue(3, 2)];
    const events = buildSlideCueEvents(cues, entries);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ srtId: 1, slideIndex: 1, startSec: 0 });
    expect(events[1]).toEqual({ srtId: 3, slideIndex: 2, startSec: 7 });
  });

  it('drops cues whose srtId is not in entries', () => {
    const entries = [entry(1, 0, 2)];
    const cues = [cue(1, 1), cue(99, 2)];
    const events = buildSlideCueEvents(cues, entries);
    expect(events).toHaveLength(1);
  });

  it('sorts events by startSec', () => {
    const entries = [entry(1, 10, 12), entry(2, 1, 3)];
    const cues = [cue(1, 1), cue(2, 2)];
    const events = buildSlideCueEvents(cues, entries);
    expect(events[0].startSec).toBe(1);
    expect(events[1].startSec).toBe(10);
  });

  it('returns empty array when no cues', () => {
    const events = buildSlideCueEvents([], [entry(1, 0, 2)]);
    expect(events).toHaveLength(0);
  });

  it('returns empty array when no entries', () => {
    const events = buildSlideCueEvents([cue(1, 1)], []);
    expect(events).toHaveLength(0);
  });
});

// ── buildTimingsFromSlideCueEvents ────────────────────────────────────────────

describe('buildTimingsFromSlideCueEvents', () => {
  it('returns empty for empty events', () => {
    expect(buildTimingsFromSlideCueEvents([], 60)).toHaveLength(0);
  });

  it('last slide ends at totalDuration', () => {
    const entries = [entry(1, 0, 2), entry(2, 5, 7)];
    const cues = [cue(1, 1), cue(2, 2)];
    const events = buildSlideCueEvents(cues, entries);
    const timings = buildTimingsFromSlideCueEvents(events, 60);
    expect(timings[timings.length - 1].endSec).toBe(60);
  });

  it('adjacent timings are contiguous', () => {
    const entries = [entry(1, 0, 2), entry(2, 5, 7), entry(3, 10, 12)];
    const cues = [cue(1, 1), cue(2, 2), cue(3, 3)];
    const events = buildSlideCueEvents(cues, entries);
    const timings = buildTimingsFromSlideCueEvents(events, 30);
    expect(timings[0].endSec).toBe(timings[1].startSec);
    expect(timings[1].endSec).toBe(timings[2].startSec);
  });

  it('single event spans full duration', () => {
    const entries = [entry(1, 2, 5)];
    const events = buildSlideCueEvents([cue(1, 1)], entries);
    const timings = buildTimingsFromSlideCueEvents(events, 60);
    expect(timings).toHaveLength(1);
    expect(timings[0].startSec).toBe(2);
    expect(timings[0].endSec).toBe(60);
  });

  it('durationSec matches endSec - startSec', () => {
    const entries = [entry(1, 0, 2), entry(2, 10, 12)];
    const events = buildSlideCueEvents([cue(1, 1), cue(2, 2)], entries);
    const timings = buildTimingsFromSlideCueEvents(events, 30);
    for (const t of timings) {
      expect(t.durationSec).toBeGreaterThanOrEqual(0.5);
    }
  });
});

// ── buildSlideCuesFromVisualCueMatches ────────────────────────────────────────

describe('buildSlideCuesFromVisualCueMatches', () => {
  it('maps valid matches to SrtSlideCues', () => {
    const matches: VisualCueMatch[] = [
      { cueIndex: 1, slideIndex: 1, startSrtId: 5 },
      { cueIndex: 2, slideIndex: 2, startSrtId: 9 },
    ];
    const cues = buildSlideCuesFromVisualCueMatches(matches);
    expect(cues).toEqual([
      { srtId: 5, slideIndex: 1 },
      { srtId: 9, slideIndex: 2 },
    ]);
  });

  it('drops matches with null slideIndex or startSrtId', () => {
    const matches: VisualCueMatch[] = [
      { cueIndex: 1, slideIndex: null, startSrtId: 5 },
      { cueIndex: 2, slideIndex: 2, startSrtId: null },
      { cueIndex: 3, slideIndex: 3, startSrtId: 7 },
    ];
    const cues = buildSlideCuesFromVisualCueMatches(matches);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toEqual({ srtId: 7, slideIndex: 3 });
  });

  it('returns empty for empty input', () => {
    expect(buildSlideCuesFromVisualCueMatches([])).toHaveLength(0);
  });
});

// ── buildSlideCuesFromTransitionMatches ───────────────────────────────────────

describe('buildSlideCuesFromTransitionMatches', () => {
  it('maps valid transition matches', () => {
    const matches: MusicTransitionMatch[] = [
      { slideIndex: 1, startSrtId: 3, confidence: 0.9 },
      { slideIndex: 2, startSrtId: 7, confidence: 0.8 },
    ];
    const cues = buildSlideCuesFromTransitionMatches(matches);
    expect(cues).toEqual([
      { srtId: 3, slideIndex: 1 },
      { srtId: 7, slideIndex: 2 },
    ]);
  });

  it('drops matches with null startSrtId', () => {
    const matches: MusicTransitionMatch[] = [
      { slideIndex: 1, startSrtId: null, confidence: 0.9 },
      { slideIndex: 2, startSrtId: 5, confidence: 0.8 },
    ];
    const cues = buildSlideCuesFromTransitionMatches(matches);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toEqual({ srtId: 5, slideIndex: 2 });
  });

  it('returns empty for empty input', () => {
    expect(buildSlideCuesFromTransitionMatches([])).toHaveLength(0);
  });
});

// ── normalizeTimings ──────────────────────────────────────────────────────────

describe('normalizeTimings', () => {
  it('returns equal distribution for empty input', () => {
    const timings = normalizeTimings([], 3, 30);
    expect(timings).toHaveLength(3);
    expect(timings[0].startSec).toBe(0);
    expect(timings[2].endSec).toBeCloseTo(30);
  });

  it('accepts startSec/endSec shape', () => {
    const input = [
      { slideIndex: 1, startSec: 0, endSec: 10, durationSec: 10 },
      { slideIndex: 2, startSec: 10, endSec: 20, durationSec: 10 },
    ];
    const timings = normalizeTimings(input, 2, 20);
    expect(timings).toHaveLength(2);
    expect(timings[0].startSec).toBe(0);
    expect(timings[1].endSec).toBe(20);
  });

  it('first slide always starts at 0', () => {
    const input = [
      { slideIndex: 1, startSec: 5, endSec: 10, durationSec: 5 },
      { slideIndex: 2, startSec: 10, endSec: 20, durationSec: 10 },
    ];
    const timings = normalizeTimings(input, 2, 20);
    expect(timings[0].startSec).toBe(0);
  });
});
