import type { SlideTimings } from './types';

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

  const totalChars = slideTexts.reduce((s, t) => s + t.length, 0);
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

function equalDistribution(slideCount: number, totalDuration: number): SlideTimings {
  const perSlide = totalDuration / slideCount;
  return Array.from({ length: slideCount }, (_, i) => ({
    slideIndex: i + 1,
    startSec: i * perSlide,
    endSec: (i + 1) * perSlide,
    durationSec: perSlide,
  }));
}

// Extract per-slide text segments from script (投影片 N：...) or plain text
export function extractSlideTexts(text: string, slideCount: number): string[] {
  const slidePattern = /投影片\s*\d+[：:]/g;
  const matches = [...text.matchAll(slidePattern)];

  if (matches.length > 0) {
    return matches.map((m, i) => {
      const start = m.index! + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
      return text.slice(start, end).trim();
    });
  }

  // Fallback: split by line count
  const lines = text.split('\n').filter(l => l.trim());
  const perSlide = Math.ceil(lines.length / slideCount);
  return Array.from({ length: slideCount }, (_, i) =>
    lines.slice(i * perSlide, (i + 1) * perSlide).join('\n')
  );
}
