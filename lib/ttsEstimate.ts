import type { NarrationMode } from './types';

// 語速係數（字/分鐘）
const CHARS_PER_MIN: Record<NarrationMode, number> = {
  duo:            220,
  solo_explainer: 230,
  solo_story:     200,
};

/** 計算腳本中 Speaker 台詞的總字數（排除投影片標題與風格行） */
export function countDialogueChars(script: string): number {
  return script
    .split('\n')
    .filter(l => /^Speaker\s+\d+/i.test(l.trim()))
    .map(l => l.replace(/^Speaker\s+\d+\s*(\([^)]*\))?\s*:\s*/i, '').trim())
    .reduce((sum, l) => sum + l.length, 0);
}

/** 回傳預估秒數 */
export function estimateTtsDuration(script: string, mode: NarrationMode): number {
  const chars = countDialogueChars(script);
  const charsPerSec = CHARS_PER_MIN[mode] / 60;
  return Math.round(chars / charsPerSec);
}

/** 預估會分成幾段（依 TTS_CHUNK_CHARS） */
export function estimateChunkCount(script: string, chunkChars: number): number {
  const total = countDialogueChars(script);
  return Math.ceil(total / chunkChars);
}
