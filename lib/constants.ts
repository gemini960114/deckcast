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

// ===== Prompts =====
export const PARSE_PDF_PROMPT =
  '請將以下每頁投影片圖片內容整理成結構化文字，格式：\n' +
  '投影片 1: [內容]\n投影片 2: [內容]\n' +
  '以此類推，每張投影片的內容要完整詳細。純文字輸出，不使用任何 Markdown 符號。';

export const PODCAST_PROMPT_TEMPLATE = (vars: {
  speaker1: string;
  speaker2: string;
  dialogueStyle: string;
  tone: string;
}) =>
  `我想製作一個 podcast 節目，介紹以下每一張投影片內容。
每張投影片請產出約 30 秒至 40 秒的對話腳本。

設定如下：
- Speaker 1 ${vars.speaker1}
- Speaker 2 ${vars.speaker2}
- ${vars.dialogueStyle}
- ${vars.tone}

請依照以下格式輸出，對話輪數依實際內容自然決定，不限制幾輪：

\`\`\`
風格: [請依據投影片內容的主題與氛圍，產生適合的朗讀風格說明]

投影片 1：[標題]
Speaker 1: ...
Speaker 2: ...
[視內容繼續對話]
\`\`\`

每張投影片請分段呈現。`.trim();

export const LYRICS_PROMPT_FREE = (styleLabel: string) =>
  `幫我創作 ${styleLabel} 風格歌詞，並依照以下投影片內容順序編寫歌詞`;

export const LYRICS_PROMPT_TIMED = (styleLabel: string, totalSec: number, endTime: string) =>
  `幫我創作 ${styleLabel} 風格歌詞，總長度恰好 ${totalSec} 秒（結束時間 ${endTime}），並依照以下投影片內容順序編寫歌詞。

請使用時間軸格式輸出，精確標註每個段落的起訖時間，格式如下：

[0:00 - 0:10] Intro: 開場氛圍與樂器描述
[0:10 - 0:40] Verse 1: 歌詞內容...
[0:40 - 1:00] Chorus: 歌詞內容...
...
[最後段落的結束時間必須恰好為 ${endTime}，所有段落加總須等於 ${totalSec} 秒]`;

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
