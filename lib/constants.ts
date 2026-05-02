// ===== API Key =====
export const API_KEY_HEADER = 'X-Gemini-Key';
export const API_KEY_SEED = 'pcast-gen-2024';
export const SESSION_KEY = 'gemini_key';
export const AUTH_TOKEN_KEY = 'deckcast_auth_token';
export const AUTH_EMAIL_KEY = 'deckcast_auth_email';

// ===== Models =====
export const TEXT_MODEL_OPTIONS = [
  { id: 'gemini-31-pro', provider: 'gemini', model: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { id: 'gemini-3-flash', provider: 'gemini', model: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { id: 'gemini-25-flash', provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'google-gemma-4-26b', provider: 'gemini', model: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B (Google)' },
  { id: 'google-gemma-4-31b', provider: 'gemini', model: 'gemma-4-31b-it', label: 'Gemma 4 31B (Google)' },
  { id: 'custom-gemma-4-31b', provider: 'openai-compatible', model: 'gemma-4-31B-it', label: 'Gemma 4 31B (Custom)' },
] as const;

export const STEP71_MODEL_OPTIONS = [
  { id: 'gemini-31-pro', provider: 'gemini', model: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { id: 'gemini-3-flash', provider: 'gemini', model: 'gemini-3-flash-preview', label: 'Gemini 3 Flash（預設）' },
  { id: 'gemini-25-flash', provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
] as const;

export const STEP41_MODEL_OPTIONS = STEP71_MODEL_OPTIONS;
export const MULTIMODAL_MODEL_OPTIONS = STEP41_MODEL_OPTIONS;

export const TTS_MODEL_OPTIONS = [
  { value: 'gemini-3.1-flash-tts-preview', label: 'gemini-3.1-flash-tts-preview' },
  { value: 'gemini-2.5-pro-preview-tts', label: 'gemini-2.5-pro-preview-tts' },
  { value: 'gemini-2.5-flash-preview-tts', label: 'gemini-2.5-flash-preview-tts（預設）' },
] as const;

export const MUSIC_MODEL_OPTIONS = [
  { value: 'lyria-3-pro-preview', label: 'lyria-3-pro-preview（預設）' },
] as const;

export type TextModelOption = typeof TEXT_MODEL_OPTIONS[number];
export type TextModelId = TextModelOption['id'];
export type Step71ModelOption = typeof STEP71_MODEL_OPTIONS[number];
export type Step71ModelId = Step71ModelOption['id'];
export type Step41ModelOption = typeof STEP41_MODEL_OPTIONS[number];
export type Step41ModelId = Step41ModelOption['id'];
export type TtsModelOption = typeof TTS_MODEL_OPTIONS[number]['value'];
export type MusicModelOption = typeof MUSIC_MODEL_OPTIONS[number]['value'];

export const DEFAULT_TEXT_MODEL: TextModelId = 'custom-gemma-4-31b';
export const DEFAULT_LOCAL_TEXT_MODEL: TextModelId = 'custom-gemma-4-31b';
export const DEFAULT_STEP41_MODEL: Step41ModelId = 'gemini-3-flash';
export const DEFAULT_STEP71_MODEL: Step71ModelId = 'gemini-3-flash';
export const DEFAULT_MULTIMODAL_MODEL: Step41ModelId = DEFAULT_STEP41_MODEL;
export const DEFAULT_TTS_MODEL: TtsModelOption = 'gemini-2.5-flash-preview-tts';
export const DEFAULT_MUSIC_MODEL: MusicModelOption = 'lyria-3-pro-preview';

const GEMINI_MODEL_NAMES = new Set<string>([
  ...TEXT_MODEL_OPTIONS.filter(option => option.provider === 'gemini').map(option => option.model),
  ...STEP71_MODEL_OPTIONS.map(option => option.model),
  ...STEP41_MODEL_OPTIONS.map(option => option.model),
  ...TTS_MODEL_OPTIONS.map(option => option.value),
  ...MUSIC_MODEL_OPTIONS.map(option => option.value),
]);

export function resolveTextModelOption(model?: string): TextModelOption {
  return TEXT_MODEL_OPTIONS.find(option => option.id === model || option.model === model)
    ?? TEXT_MODEL_OPTIONS.find(option => option.id === DEFAULT_TEXT_MODEL)!;
}

export function resolveTextModelId(model?: string): TextModelId {
  return resolveTextModelOption(model).id;
}

export function resolveTextModel(model?: string): string {
  return resolveTextModelOption(model).model;
}

export function resolveStep71ModelOption(model?: string): Step71ModelOption {
  return STEP71_MODEL_OPTIONS.find(option => option.id === model || option.model === model)
    ?? STEP71_MODEL_OPTIONS.find(option => option.id === DEFAULT_STEP71_MODEL)!;
}

export function resolveStep71ModelId(model?: string): Step71ModelId {
  return resolveStep71ModelOption(model).id;
}

export function resolveStep71Model(model?: string): string {
  return resolveStep71ModelOption(model).model;
}

export function resolveStep41ModelOption(model?: string): Step41ModelOption {
  return STEP41_MODEL_OPTIONS.find(option => option.id === model || option.model === model)
    ?? STEP41_MODEL_OPTIONS.find(option => option.id === DEFAULT_STEP41_MODEL)!;
}

export function resolveStep41ModelId(model?: string): Step41ModelId {
  return resolveStep41ModelOption(model).id;
}

export function resolveStep41Model(model?: string): string {
  return resolveStep41ModelOption(model).model;
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
  return resolveTextModelOption(model).provider === 'gemini';
}

export function isGeminiModel(model?: string): boolean {
  return GEMINI_MODEL_NAMES.has(model ?? '');
}

// ===== Content Language =====
import type { ContentLanguage, NarrationLengthPreset } from './types';

export const DEFAULT_CONTENT_LANGUAGE: ContentLanguage = 'zh-TW';

export const CONTENT_LANGUAGE_OPTIONS: { value: ContentLanguage; label: string }[] = [
  { value: 'zh-TW', label: '繁體中文（zh-TW）' },
  { value: 'en',    label: 'English' },
  { value: 'ja',    label: '日本語' },
  { value: 'ko',    label: '한국어' },
];

/** 傳給 prompt 的語言標示（英文，模型最穩定） */
export const CONTENT_LANGUAGE_PROMPT_LABEL: Record<ContentLanguage, string> = {
  'zh-TW': 'Traditional Chinese (Taiwan)',
  'en':    'English',
  'ja':    'Japanese',
  'ko':    'Korean',
};

// ===== Narration Length =====
export const DEFAULT_NARRATION_LENGTH_PRESET: NarrationLengthPreset = 'brief';

export const NARRATION_LENGTH_PRESETS: {
  value: NarrationLengthPreset;
  label: string;
  promptLabel: string;
}[] = [
  { value: 'brief',    label: 'Brief（精簡）– 每頁約 15–25 秒',      promptLabel: '每張投影片約 15 至 25 秒' },
  { value: 'balanced', label: 'Balanced（標準 ⭐）– 每頁約 30–45 秒', promptLabel: '每張投影片約 30 至 45 秒' },
  { value: 'detailed', label: 'Detailed（詳細）– 每頁約 45–60 秒',   promptLabel: '每張投影片約 45 至 60 秒' },
];

// ===== Default Settings =====
export const DEFAULT_SPEAKER1 = '阿哲';
export const DEFAULT_SPEAKER2 = 'Mary 老師';
export const DEFAULT_DIALOGUE_STYLE = '採自然流暢的對話形式，具有節目感與互動感';
export const DEFAULT_TONE = '語氣親切、易懂，適合一般聽眾';
export const DEFAULT_VOICE1 = 'Puck';
export const DEFAULT_VOICE2 = 'Zephyr';
export const DEFAULT_STYLE_ID = 1;
export const DEFAULT_LYRICS_DURATION = '105';

// ===== TTS Chunking Thresholds =====
export const TTS_WARN_SEC    = 200;  // 實際音訊 ~2.5 分鐘時觸發提示（estSec = 實際 × 1.33）
export const TTS_LONG_SEC    = 320;  // 實際音訊 ~4 分鐘時觸發長篇警示（estSec = 實際 × 1.33）
export const TTS_CHUNK_CHARS = 650;   // 後端每段台詞字數上限（**中文基準**，330 chars/min ≈ 2.0 分鐘）；其他語言依 TTS_CHUNK_LANG_MULTIPLIER 倍率推算
export const CHUNK_GAP_MS    = 800;  // chunk 間插入的固定靜音（ms）

// ===== TTS Chunk Audio Postprocessing (plan: PLAN_TTS_CHUNK_AUDIO_POSTPROCESSING.md) =====
// Phase A: whole-file loudnorm to ~-16 LUFS podcast target.
// Phase B: per-chunk loudness analysis + conservative gain matching.
// Phase C: short crossfade / controlled gap for smoother boundaries.
export const TTS_TARGET_LUFS                = -16;   // integrated loudness target (I=)
export const TTS_TRUE_PEAK                  = -1.5;  // true peak ceiling (TP=)
export const TTS_LRA                        = 11;    // loudness range (LRA=)
export const TTS_GAIN_MATCH_THRESHOLD_DB    = 1.5;   // ignore deltas smaller than this
export const TTS_GAIN_MATCH_MAX_DB          = 4;     // cap per-chunk correction

// Phase C slide-boundary transition: chunk boundaries mostly align with slide
// boundaries, so we use a fade-out + silence + fade-in transition instead of a
// tight crossfade. This gives a natural "turning the page" feel instead of a
// hard-edit or over-long pause. Values are overridable via env
// (TTS_SLIDE_FADE_OUT_MS / TTS_SLIDE_SILENCE_MS / TTS_SLIDE_FADE_IN_MS).
export const TTS_SLIDE_FADE_OUT_MS          = 100;   // chunk tail fade-out
export const TTS_SLIDE_SILENCE_MS           = 500;   // silence gap between chunks
export const TTS_SLIDE_FADE_IN_MS           = 80;    // chunk head fade-in

// Reserved for future intra-slide boundary handling (when one slide is split
// across chunks). Not currently used by the slide transition filter.
export const TTS_CROSSFADE_MS               = 10;    // reserved: intra-slide crossfade
export const TTS_FALLBACK_GAP_MS            = 60;    // reserved: intra-slide fallback gap

/**
 * Per-language multiplier for TTS_CHUNK_CHARS.
 *
 * Goal: every chunk produces roughly 115-130s of audio regardless of language,
 * so Gemini TTS quality degradation (>2.5min) hits all languages at a similar
 * boundary. Without this, English scripts chunked at 650 chars only produce
 * ~47s per chunk, wasting Gemini calls and triggering false long-script
 * warnings.
 *
 * Baseline (zh-TW): 650 chars @ 330 chars/min ≈ 118s.
 * en=2.5x / ja=1.5x / ko=1.25x derived from per-language speech rate estimates;
 * see plan_B for reasoning. Tune after real TTS listening if needed.
 */
export const TTS_CHUNK_LANG_MULTIPLIER: Record<ContentLanguage, number> = {
  'zh-TW': 1.0,
  en:      2.5,   // ~825 chars/min → 1625 chars ≈ 118s
  ja:      1.5,   // ~495 chars/min → 975 chars ≈ 118s
  ko:      1.25,  // ~413 chars/min → 813 chars ≈ 118s
};

/**
 * Resolve the effective TTS_CHUNK_CHARS for a given content language.
 * Unknown or undefined language falls back to the zh-TW baseline, so legacy
 * records without contentLanguage keep their current behavior (650 chars).
 */
export function resolveTtsChunkChars(language?: ContentLanguage): number {
  const lang = language ?? DEFAULT_CONTENT_LANGUAGE;
  const mult = TTS_CHUNK_LANG_MULTIPLIER[lang] ?? 1.0;
  return Math.round(TTS_CHUNK_CHARS * mult);
}

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

// ===== Audio Tags =====
export const ALLOWED_AUDIO_TAGS = [
  'neutral', 'enthusiasm', 'interest', 'curiosity', 'positive', 'tension',
  'slow', 'fast',
  'short pause', 'long pause',
  'whispers', 'laughs',
] as const;

// ===== Timing / Transition =====
export const TRANSITION_COMPENSATION_SEC = 0.25;
export const MIN_VISIBLE_SLIDE_SEC = 0.5;
export const LAST_SLIDE_TAIL_SEC = 2.0;
