// ===== API Key =====
export const API_KEY_HEADER = 'X-Gemini-Key';
export const API_KEY_SEED = 'pcast-gen-2024';
export const SESSION_KEY = 'gemini_key';
export const AUTH_TOKEN_KEY = 'deckcast_auth_token';
export const AUTH_EMAIL_KEY = 'deckcast_auth_email';

// ===== Models =====
export const TEXT_MODEL_OPTIONS = [
  { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview' },
  { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
  { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
  { value: 'gemma-4-31B-it', label: 'Gemma 4' },
] as const;

export const STEP71_MODEL_OPTIONS = [
  { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview' },
  { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview（預設）' },
  { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
] as const;

export const STEP41_MODEL_OPTIONS = STEP71_MODEL_OPTIONS;
export const MULTIMODAL_MODEL_OPTIONS = STEP41_MODEL_OPTIONS;

export const TTS_MODEL_OPTIONS = [
  { value: 'gemini-2.5-pro-preview-tts', label: 'gemini-2.5-pro-preview-tts' },
  { value: 'gemini-2.5-flash-preview-tts', label: 'gemini-2.5-flash-preview-tts（預設）' },
] as const;

export const MUSIC_MODEL_OPTIONS = [
  { value: 'lyria-3-pro-preview', label: 'lyria-3-pro-preview（預設）' },
] as const;

export type TextModelOption = typeof TEXT_MODEL_OPTIONS[number]['value'];
export type Step71ModelOption = typeof STEP71_MODEL_OPTIONS[number]['value'];
export type Step41ModelOption = typeof STEP41_MODEL_OPTIONS[number]['value'];
export type TtsModelOption = typeof TTS_MODEL_OPTIONS[number]['value'];
export type MusicModelOption = typeof MUSIC_MODEL_OPTIONS[number]['value'];

export const DEFAULT_TEXT_MODEL: TextModelOption = 'gemini-3-flash-preview';
export const DEFAULT_LOCAL_TEXT_MODEL: TextModelOption = 'gemma-4-31B-it';
export const DEFAULT_STEP41_MODEL: Step41ModelOption = 'gemini-3-flash-preview';
export const DEFAULT_STEP71_MODEL: Step71ModelOption = 'gemini-3-flash-preview';
export const DEFAULT_MULTIMODAL_MODEL: Step41ModelOption = DEFAULT_STEP41_MODEL;
export const DEFAULT_TTS_MODEL: TtsModelOption = 'gemini-2.5-flash-preview-tts';
export const DEFAULT_MUSIC_MODEL: MusicModelOption = 'lyria-3-pro-preview';

export function resolveTextModel(model?: string): TextModelOption {
  return TEXT_MODEL_OPTIONS.some(option => option.value === model)
    ? (model as TextModelOption)
    : DEFAULT_TEXT_MODEL;
}

export function resolveStep71Model(model?: string): Step71ModelOption {
  return STEP71_MODEL_OPTIONS.some(option => option.value === model)
    ? (model as Step71ModelOption)
    : DEFAULT_STEP71_MODEL;
}

export function resolveStep41Model(model?: string): Step41ModelOption {
  return STEP41_MODEL_OPTIONS.some(option => option.value === model)
    ? (model as Step41ModelOption)
    : DEFAULT_STEP41_MODEL;
}

export function resolveTtsModel(model?: string): TtsModelOption {
  return TTS_MODEL_OPTIONS.some(option => option.value === model)
    ? (model as TtsModelOption)
    : DEFAULT_TTS_MODEL;
}

export function resolveMusicModel(model?: string): MusicModelOption {
  return MUSIC_MODEL_OPTIONS.some(option => option.value === model)
    ? (model as MusicModelOption)
    : DEFAULT_MUSIC_MODEL;
}

export function isGeminiTextModel(model?: string): boolean {
  return resolveTextModel(model).startsWith('gemini-');
}

export function isGeminiModel(model?: string): boolean {
  return (model ?? '').startsWith('gemini-');
}

// ===== Default Settings =====
export const DEFAULT_SPEAKER1 = '男生為節目主持人 阿哲';
export const DEFAULT_SPEAKER2 = '女生為高師大的老師 Mary 老師（具教學經驗，說明清楚）';
export const DEFAULT_DIALOGUE_STYLE = '採自然流暢的對話形式，具有節目感與互動感';
export const DEFAULT_TONE = '語氣親切、易懂，適合一般聽眾';
export const DEFAULT_VOICE1 = 'Puck';
export const DEFAULT_VOICE2 = 'Zephyr';
export const DEFAULT_STYLE_ID = 1;
export const DEFAULT_LYRICS_DURATION = '105';

// ===== Media Upload Rules =====
export const PODCAST_MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MUSIC_MAX_FILE_SIZE = 20 * 1024 * 1024;
export const PODCAST_AUDIO_ACCEPT = '.mp3,.wav,.m4a,.aac,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac';
export const MUSIC_AUDIO_ACCEPT = '.mp3,audio/mpeg';

// ===== Lyrics Duration =====
export const LYRICS_DURATIONS = [
  { label: 'Short（精華版）– 60s', value: '60' },
  { label: 'Standard（主打歌 ⭐）– 105s', value: '105' },
  { label: 'Full（完整版）– 135s', value: '135' },
  { label: 'Pro（演唱會版）– 180s', value: '180' }
] as const;

/**
 * 回傳對應的 Lyria 3 模型
 */
export function getMusicModel(duration: string, model?: string): MusicModelOption {
  void duration;
  return resolveMusicModel(model);
}

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
