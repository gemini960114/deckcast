// ===== API Key =====
export const API_KEY_HEADER = 'X-Gemini-Key';
export const API_KEY_SEED   = 'pcast-gen-2024';
export const SESSION_KEY    = 'gemini_key';

// ===== Models =====
export const MODEL_TEXT  = 'gemini-3-flash-preview';
export const MODEL_MUSIC = 'lyria-3-pro-preview';
export const MODEL_TTS   = 'gemini-2.5-flash-preview-tts';

// ===== Default Settings =====
export const DEFAULT_SPEAKER1        = '男生為節目主持人';
export const DEFAULT_SPEAKER2        = '女生為高師大的老師 Mary 老師（具教學經驗，說明清楚）';
export const DEFAULT_DIALOGUE_STYLE  = '採自然流暢的對話形式，具有節目感與互動感';
export const DEFAULT_TONE            = '語氣親切、易懂，適合一般聽眾';
export const DEFAULT_VOICE1          = 'Puck';
export const DEFAULT_VOICE2          = 'Zephyr';
export const DEFAULT_STYLE_ID        = 1;
export const DEFAULT_LYRICS_DURATION = '90-second';

// ===== Lyrics Duration =====
export const LYRICS_FREE_STYLE = 'Free style';
export const LYRICS_DURATIONS  = [
  'Free style', '30-second', '60-second', '90-second',
  '120-second', '150-second', '180-second',
] as const;

// ===== Voice Sample URL =====
export const voiceSampleUrl = (name: string) =>
  `https://www.gstatic.com/aistudio/voices/samples/${name}.wav`;



// ===== API Key Codec (XOR + base64) =====
function xorWithSeed(str: string, seed: string): string {
  return Array.from(str)
    .map((ch, i) => String.fromCharCode(ch.charCodeAt(0) ^ seed.charCodeAt(i % seed.length)))
    .join('');
}

export function encodeApiKey(raw: string): string {
  return btoa(xorWithSeed(raw, API_KEY_SEED));
}

export function decodeApiKey(encoded: string): string {
  return xorWithSeed(atob(encoded), API_KEY_SEED);
}
