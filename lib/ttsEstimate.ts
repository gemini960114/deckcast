import type { ContentLanguage, NarrationMode } from './types';

// 語速係數（字/分鐘）
//
// 外層 key = narrationMode，內層 key = contentLanguage。
// zh-TW 值為 2026-04-19 UI 遷移時的實測校正基準；其他語言依 plan_B 的
// 倍率（en=2.5x / ja=1.5x / ko=1.25x）換算，尚未實測微調。若之後聽測發
// 現某語言音訊長度偏離 145-160s 目標，先調這裡。
const CHARS_PER_MIN: Record<NarrationMode, Record<ContentLanguage, number>> = {
  duo: {
    'zh-TW': 330,
    en:      825,
    ja:      495,
    ko:      413,
  },
  solo_explainer: {
    'zh-TW': 345,
    en:      862,
    ja:      518,
    ko:      431,
  },
  solo_story: {
    'zh-TW': 300,
    en:      750,
    ja:      450,
    ko:      375,
  },
};

/** 計算腳本中 Speaker 台詞的總字數（排除投影片標題與風格行） */
export function countDialogueChars(script: string): number {
  return script
    .split('\n')
    .filter(l => /^Speaker\s+\d+/i.test(l.trim()))
    .map(l => l.replace(/^Speaker\s+\d+\s*(\([^)]*\))?\s*:\s*/i, '').trim())
    .reduce((sum, l) => sum + l.length, 0);
}

/**
 * 回傳預估秒數。language 未提供時 fallback 到 zh-TW，維持原呼叫向後相容。
 */
export function estimateTtsDuration(
  script: string,
  mode: NarrationMode,
  language: ContentLanguage = 'zh-TW',
): number {
  const chars = countDialogueChars(script);
  const charsPerSec = CHARS_PER_MIN[mode][language] / 60;
  return Math.round(chars / charsPerSec);
}

/**
 * 預估會分成幾段。chunkChars 由呼叫端自行透過 `resolveTtsChunkChars(language)`
 * 算出；本函式刻意不耦合語言 — 只做純數學除法，UI 可拿這個值去推估段間停
 * 頓時間。
 */
export function estimateChunkCount(script: string, chunkChars: number): number {
  const total = countDialogueChars(script);
  return Math.ceil(total / chunkChars);
}
