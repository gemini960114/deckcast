import type { LyricSection, LyricVisualTag, MusicTransitionMatch, SlideCueEvent, SlideTimings, SrtEntry, SrtSlideCue, VisualCueMatch, VisualCueTiming } from './types';

export function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = reject;
    audio.src = url;
  });
}

// Podcast timing: estimate per-slide duration from character count
export async function calcPodcastTimings(
  script: string,
  slideCount: number,
  podcastBlob: Blob
): Promise<SlideTimings> {
  const totalDuration = await getAudioDuration(podcastBlob);

  const slidePattern = /投影片\s*(\d+)[：:]/g;
  const matches = [...script.matchAll(slidePattern)];

  if (matches.length === 0) {
    return equalDistribution(slideCount, totalDuration);
  }

  const slideTexts: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : script.length;
    slideTexts.push(script.slice(start, end));
  }

  // Only count chars for slides within slideCount — extra script sections beyond slideCount
  // would dilute proportions and cause all slides to advance too early.
  const totalChars = slideTexts.slice(0, slideCount).reduce((s, t) => s + t.length, 0);
  const timings: SlideTimings = [];
  let currentSec = 0;

  for (let i = 0; i < slideCount; i++) {
    const text = slideTexts[i] ?? '';
    const ratio = totalChars > 0 ? text.length / totalChars : 1 / slideCount;
    const duration = totalDuration * ratio;
    timings.push({
      slideIndex: i + 1,
      startSec: currentSec,
      endSec: currentSec + duration,
      durationSec: duration,
    });
    currentSec += duration;
  }

  return timings;
}

// Music timing: 優先從歌詞時間戳記解析，失敗則均分
export async function calcMusicTimings(
  slideCount: number,
  musicBlob: Blob,
  lyrics?: string
): Promise<SlideTimings> {
  const totalDuration = await getAudioDuration(musicBlob);

  if (lyrics) {
    const parsed = parseLyricsTimings(lyrics, slideCount, totalDuration);
    if (parsed.length > 0) return parsed;
  }

  return equalDistribution(slideCount, totalDuration);
}

export function parseLyricsTimings(
  lyrics: string,
  slideCount: number,
  totalDuration: number
): SlideTimings {
  const timestampRegex = /\[(\d+\.?\d*):\]/g;
  const timestamps: number[] = [];
  let match;
  while ((match = timestampRegex.exec(lyrics)) !== null) {
    const sec = parseFloat(match[1]);
    if (timestamps.length === 0 || sec !== timestamps[timestamps.length - 1]) {
      timestamps.push(sec);
    }
  }

  if (timestamps.length === 0) return [];

  const timings: SlideTimings = [];
  const perSlideSegments = Math.max(1, Math.floor(timestamps.length / slideCount));

  for (let i = 0; i < slideCount; i++) {
    const tsIndex = i * perSlideSegments;
    const startSec = timestamps[tsIndex] ?? timestamps[timestamps.length - 1];
    const nextTsIndex = (i + 1) * perSlideSegments;
    const endSec = nextTsIndex < timestamps.length
      ? timestamps[nextTsIndex]
      : totalDuration;

    timings.push({
      slideIndex: i + 1,
      startSec,
      endSec,
      durationSec: Math.max(endSec - startSec, 1),
    });
  }

  return timings;
}

export function parseLyricSections(lyrics: string): LyricSection[] {
  const lines = lyrics.split('\n');
  const sections: LyricSection[] = [];
  let current: LyricSection | null = null;
  let sectionIndex = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const headerMatch = line.match(/^\[([^\]]+)\]\s*\[Slide\s*(\d+)\]/i);
    if (headerMatch) {
      if (current) sections.push(current);
      sectionIndex++;
      const visualTag: LyricVisualTag = { kind: 'slide', slideIndex: parseInt(headerMatch[2], 10) };
      current = {
        sectionIndex,
        sectionLabel: headerMatch[1].trim(),
        visualTag,
        rawHeader: line,
        lines: [],
      };
      continue;
    }
    if (current && line) current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

export function buildVisualCueTimings(
  sections: LyricSection[],
  matches: VisualCueMatch[],
  srtEntries: SrtEntry[],
  totalDuration: number
): VisualCueTiming[] {
  const idToEntry = new Map(srtEntries.map(e => [e.id, e]));
  const matchByCue = new Map(matches.map(m => [m.cueIndex, m]));

  const startTimes: Array<number | null> = sections.map((_, i) => {
    if (i === 0) return 0;
    const match = matchByCue.get(i + 1);
    if (!match || match.startSrtId == null) return null;
    return idToEntry.get(match.startSrtId)?.start ?? null;
  });

  const resolved = interpolateStartTimes(startTimes, totalDuration);

  return sections.map((section, i) => {
    const startSec = i === 0 ? 0 : resolved[i];
    const endSec = i + 1 < resolved.length ? resolved[i + 1] : totalDuration;
    return {
      cueIndex: section.sectionIndex,
      slideIndex: section.visualTag.slideIndex,
      startSec,
      endSec,
      durationSec: Math.max(endSec - startSec, 0.5),
    };
  });
}

function ensureFinalTimings(timings: SlideTimings, slideCount: number, totalDuration: number): SlideTimings {
  if (!timings.length) return equalDistribution(slideCount, totalDuration);

  const sorted = [...timings]
    .sort((a, b) => a.slideIndex - b.slideIndex)
    .slice(0, slideCount)
    .map((timing, index) => ({
      slideIndex: index + 1,
      startSec: Math.max(0, timing.startSec),
      endSec: Math.max(0, timing.endSec),
      durationSec: Math.max(0, timing.durationSec),
    }));

  while (sorted.length < slideCount) {
    const lastEnd = sorted.length ? sorted[sorted.length - 1].endSec : 0;
    sorted.push({
      slideIndex: sorted.length + 1,
      startSec: lastEnd,
      endSec: lastEnd,
      durationSec: 0,
    });
  }

  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      sorted[i].startSec = 0;
    } else if (sorted[i].startSec < sorted[i - 1].endSec) {
      sorted[i].startSec = sorted[i - 1].endSec;
    }

    const nextStart = i + 1 < sorted.length ? Math.max(sorted[i + 1].startSec, sorted[i].startSec + 0.5) : totalDuration;
    sorted[i].endSec = i + 1 < sorted.length ? nextStart : totalDuration;
    sorted[i].durationSec = Math.max(sorted[i].endSec - sorted[i].startSec, 0.5);
  }

  sorted[sorted.length - 1].endSec = totalDuration;
  sorted[sorted.length - 1].durationSec = Math.max(totalDuration - sorted[sorted.length - 1].startSec, 0.5);

  return sorted;
}

function interpolateStartTimes(startTimes: Array<number | null>, totalDuration: number): number[] {
  const resolved = [...startTimes];
  resolved[0] = 0;

  let lastKnownIndex = 0;
  for (let i = 1; i < resolved.length; i++) {
    if (resolved[i] !== null) {
      const previousValue = resolved[lastKnownIndex] ?? 0;
      const currentValue = Math.max(previousValue + 0.5, resolved[i] ?? previousValue + 0.5);
      const gap = i - lastKnownIndex;
      for (let j = 1; j < gap; j++) {
        resolved[lastKnownIndex + j] = previousValue + ((currentValue - previousValue) * j) / gap;
      }
      resolved[i] = currentValue;
      lastKnownIndex = i;
    }
  }

  const tailStart = resolved[lastKnownIndex] ?? 0;
  const remaining = resolved.length - 1 - lastKnownIndex;
  for (let i = lastKnownIndex + 1; i < resolved.length; i++) {
    const ratio = remaining > 0 ? (i - lastKnownIndex) / remaining : 1;
    resolved[i] = tailStart + Math.max((totalDuration - tailStart) * ratio, 0.5 * (i - lastKnownIndex));
  }

  return resolved.map((value, index) => {
    const safeValue = Math.max(0, Math.min(value ?? 0, totalDuration));
    if (index === 0) return 0;
    const prev = resolved[index - 1] ?? 0;
    return Math.max(safeValue, Math.min(totalDuration, prev + 0.5));
  });
}

export function buildSlideTimingsFromSrtIds(
  matches: MusicTransitionMatch[],
  srtEntries: SrtEntry[],
  slideCount: number,
  totalDuration: number
): SlideTimings {
  if (!matches.length || !srtEntries.length) {
    return equalDistribution(slideCount, totalDuration);
  }

  const idToEntry = new Map(srtEntries.map(entry => [entry.id, entry]));
  const startTimes: Array<number | null> = Array.from({ length: slideCount }, (_, index) => (index === 0 ? 0 : null));

  for (const match of matches) {
    if (match.slideIndex < 1 || match.slideIndex > slideCount || match.startSrtId == null) continue;
    const entry = idToEntry.get(match.startSrtId);
    if (!entry) continue;
    startTimes[match.slideIndex - 1] = entry.start;
  }

  const resolvedStarts = interpolateStartTimes(startTimes, totalDuration);
  const timings: SlideTimings = resolvedStarts.map((startSec, index) => {
    const actualStart = index === 0 ? 0 : startSec;
    const nextStart = index + 1 < resolvedStarts.length ? resolvedStarts[index + 1] : totalDuration;
    return {
      slideIndex: index + 1,
      startSec: actualStart,
      endSec: index + 1 < resolvedStarts.length ? nextStart : totalDuration,
      durationSec: Math.max((index + 1 < resolvedStarts.length ? nextStart : totalDuration) - actualStart, 0.5),
    };
  });

  return ensureFinalTimings(timings, slideCount, totalDuration);
}

export function buildMusicFallbackTimingsByLyricsWeight(
  lyrics: string,
  slideCount: number,
  totalDuration: number
): SlideTimings {
  const sections = parseLyricSections(lyrics);
  if (sections.length === 0) return equalDistribution(slideCount, totalDuration);

  const cueWeights: Array<{ slideIndex: number; weight: number }> = [];
  for (const section of sections) {
    cueWeights.push({
      slideIndex: section.visualTag.slideIndex,
      weight: Math.max(section.lines.length, 1),
    });
  }

  if (cueWeights.length === 0) return equalDistribution(slideCount, totalDuration);

  const totalWeight = cueWeights.reduce((sum, c) => sum + c.weight, 0);
  const slideFirstSec = new Map<number, number>();
  let elapsed = 0;
  for (const cue of cueWeights) {
    if (!slideFirstSec.has(cue.slideIndex)) {
      slideFirstSec.set(cue.slideIndex, (elapsed / totalWeight) * totalDuration);
    }
    elapsed += cue.weight;
  }

  const startTimes: Array<number | null> = Array.from(
    { length: slideCount },
    (_, i) => slideFirstSec.get(i + 1) ?? null
  );
  if (startTimes[0] === null) startTimes[0] = 0;

  const resolved = interpolateStartTimes(startTimes, totalDuration);
  return resolved.map((startSec, i) => {
    const endSec = i + 1 < resolved.length ? resolved[i + 1] : totalDuration;
    return {
      slideIndex: i + 1,
      startSec: i === 0 ? 0 : startSec,
      endSec,
      durationSec: Math.max(endSec - startSec, 0.5),
    };
  });
}

export function buildPodcastFallbackTimingsByScriptWeight(
  script: string,
  slideCount: number,
  totalDuration: number
): SlideTimings {
  const slidePattern = /投影片\s*(\d+)[：:]/g;
  const matches = [...script.matchAll(slidePattern)];

  if (matches.length === 0) {
    return equalDistribution(slideCount, totalDuration);
  }

  const sections: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : script.length;
    sections.push(script.slice(start, end).trim());
  }

  const weights = Array.from({ length: slideCount }, (_, index) =>
    Math.max((sections[index] ?? '').replace(/\s+/g, '').length, 1)
  );
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);

  let currentSec = 0;
  const timings: SlideTimings = weights.map((weight, index) => {
    const duration = totalWeight > 0 ? (totalDuration * weight) / totalWeight : totalDuration / slideCount;
    const startSec = currentSec;
    const endSec = index === slideCount - 1 ? totalDuration : currentSec + duration;
    currentSec = endSec;
    return {
      slideIndex: index + 1,
      startSec,
      endSec,
      durationSec: Math.max(endSec - startSec, 0.5),
    };
  });

  return ensureFinalTimings(timings, slideCount, totalDuration);
}

function equalDistribution(slideCount: number, totalDuration: number): SlideTimings {
  const perSlide = totalDuration / slideCount;
  return Array.from({ length: slideCount }, (_, i) => ({
    slideIndex: i + 1,
    startSec: i * perSlide,
    endSec: (i + 1) * perSlide,
    durationSec: perSlide,
  }));
}

// AI Timing Normalizer: safeguards AI estimations and accepts legacy or final timing shapes.
export function normalizeTimings(
  aiTimings: Array<{ slideIndex: number; durationSec?: number; vocalStartSec?: number; startSec?: number; endSec?: number }>,
  slideCount: number,
  totalDuration: number
): SlideTimings {
  if (!aiTimings || aiTimings.length === 0) {
    return equalDistribution(slideCount, totalDuration);
  }

  if (aiTimings[0] && aiTimings[0].startSec !== undefined && aiTimings[0].endSec !== undefined) {
    const finalTimings = aiTimings.map(t => ({
      slideIndex: t.slideIndex,
      startSec: t.startSec ?? 0,
      endSec: t.endSec ?? totalDuration,
      durationSec: t.durationSec ?? Math.max((t.endSec ?? totalDuration) - (t.startSec ?? 0), 0.5),
    }));
    return ensureFinalTimings(finalTimings, slideCount, totalDuration);
  }

  if (aiTimings[0] && aiTimings[0].vocalStartSec === undefined && aiTimings[0].durationSec !== undefined) {
    const validTimings = [];
    let sumDuration = 0;
    for (let i = 1; i <= slideCount; i++) {
      const hit = aiTimings.find(t => t.slideIndex === i);
      const dur = hit && hit.durationSec && hit.durationSec > 0 ? hit.durationSec : 10;
      validTimings.push({ slideIndex: i, durationSec: dur });
      sumDuration += dur;
    }

    if (sumDuration <= 0) return equalDistribution(slideCount, totalDuration);

    const timings: SlideTimings = [];
    let currentSec = 0;
    for (const t of validTimings) {
      const ratio = t.durationSec / sumDuration;
      const scaledDuration = totalDuration * ratio;

      timings.push({
        slideIndex: t.slideIndex,
        startSec: currentSec,
        endSec: currentSec + scaledDuration,
        durationSec: Math.max(scaledDuration, 1),
      });
      currentSec += scaledDuration;
    }
    return ensureFinalTimings(timings, slideCount, totalDuration);
  }

  const startTimes: number[] = [];
  for (let i = 1; i <= slideCount; i++) {
    const hit = aiTimings.find(t => t.slideIndex === i);
    let st = hit?.vocalStartSec;

    if (typeof st !== 'number') {
      st = startTimes.length > 0 ? startTimes[startTimes.length - 1] + 5 : 0;
    }

    st = Math.max(0, Math.min(st, totalDuration));
    startTimes.push(st);
  }

  for (let i = 1; i < startTimes.length; i++) {
    if (startTimes[i] <= startTimes[i - 1]) {
      startTimes[i] = Math.min(startTimes[i - 1] + 1, totalDuration);
    }
  }

  const timings: SlideTimings = [];
  for (let i = 0; i < slideCount; i++) {
    const nextStart = i + 1 < slideCount ? startTimes[i + 1] : totalDuration;
    const actualStart = i === 0 ? 0 : startTimes[i];
    const dur = Math.max(nextStart - actualStart, 1);

    timings.push({
      slideIndex: i + 1,
      startSec: actualStart,
      endSec: actualStart + dur,
      durationSec: dur,
    });
  }

  return ensureFinalTimings(timings, slideCount, totalDuration);
}

/**
 * 計算實際可用的轉場秒數（PPTX 與 MP4 共用）。
 *
 * 規則：
 *   - 目標是 transitionSec（0.25s）
 *   - 但不能讓頁面可見時間少於 minVisibleSec
 *   - 最小保底 0.1s（維持轉場視覺效果）
 *
 * 等價於 videoExport.ts 的 fadeDur 計算，確保兩端一致。
 */
export function resolveEffectiveTransitionSec(
  durationSec: number,
  transitionSec: number,
  minVisibleSec: number,
): number {
  return Math.min(transitionSec, Math.max(0.1, durationSec - minVisibleSec));
}

/**
 * 產生供 PPTX 輸出使用的 adjusted timings。
 *
 * 規則：
 *   - 第 1 到第 N-1 頁：durationSec -= actualFade（提早啟動轉場）
 *   - actualFade 由 resolveEffectiveTransitionSec() 決定，與 MP4 端邏輯一致
 *   - 最後一頁：保持原始 startSec / endSec / durationSec
 *
 * 不回寫 state / IndexedDB / SRT，僅供輸出層使用。
 */
export function buildTransitionAdjustedTimings(
  timings: SlideTimings,
  transitionSec: number,
  minVisibleSec: number,
): SlideTimings {
  if (timings.length === 0) return [];

  return timings.map((t, i) => {
    if (i === timings.length - 1) {
      return { ...t };
    }
    const actualFade = resolveEffectiveTransitionSec(t.durationSec, transitionSec, minVisibleSec);
    const adjustedDuration = t.durationSec - actualFade;
    const adjustedEnd = t.startSec + adjustedDuration;
    return {
      ...t,
      endSec: adjustedEnd,
      durationSec: adjustedDuration,
    };
  });
}

export function buildSlideCueEvents(slideCues: SrtSlideCue[], srtEntries: SrtEntry[]): SlideCueEvent[] {
  const idToEntry = new Map(srtEntries.map(e => [e.id, e]));
  const events: SlideCueEvent[] = [];

  for (const cue of slideCues) {
    const entry = idToEntry.get(cue.srtId);
    if (!entry) continue;
    events.push({ srtId: cue.srtId, slideIndex: cue.slideIndex, startSec: entry.start });
  }

  return events.sort((a, b) => a.startSec - b.startSec || a.srtId - b.srtId);
}

export function buildTimingsFromSlideCueEvents(
  events: SlideCueEvent[],
  totalDuration: number
): SlideTimings {
  if (events.length === 0) return [];

  return events.map((event, i) => {
    const startSec = i === 0 ? Math.max(0, event.startSec) : event.startSec;
    const endSec = i + 1 < events.length ? events[i + 1].startSec : totalDuration;
    const durationSec = Math.max(endSec - startSec, 0.5);
    return {
      slideIndex: event.slideIndex,
      startSec,
      endSec,
      durationSec,
    };
  });
}

export function buildSlideCuesFromVisualCueMatches(
  matches: import('./types').VisualCueMatch[]
): SrtSlideCue[] {
  return matches
    .filter(m => m.slideIndex !== null && m.startSrtId !== null)
    .map(m => ({ srtId: m.startSrtId as number, slideIndex: m.slideIndex as number }));
}

export function buildSlideCuesFromTransitionMatches(
  matches: MusicTransitionMatch[]
): SrtSlideCue[] {
  return matches
    .filter(m => m.startSrtId !== null)
    .map(m => ({ srtId: m.startSrtId as number, slideIndex: m.slideIndex }));
}

// Applies offset to slide timings (only updates endSec and adjusts duration accordingly)
export function shiftTimings(timings: SlideTimings, offsetSec: number): SlideTimings {
  if (!offsetSec || offsetSec === 0) return timings;
  
  return timings.map((t, idx) => {
    const newStart = idx === 0 ? 0 : Math.max(0, t.startSec + offsetSec);
    const newEnd = Math.max(0, t.endSec + offsetSec);
    return {
      ...t,
      startSec: newStart,
      endSec: newEnd,
      durationSec: Math.max(0.25, newEnd - newStart),
    };
  });
}

