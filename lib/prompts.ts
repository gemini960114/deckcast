import { LYRICS_FREE_STYLE } from './constants';

// ===== Align Prompts =====
export const ALIGN_MUSIC_PROMPT = `
我將提供一首 AI 生成的歌曲音檔，以及其對應的歌詞本（內含「投影片 N」的標記）。
請化身為專業的 MV 導播，仔細聆聽整首歌的段落結構（前奏、主歌、副歌、間奏等）。
請精準抓出「每一張投影片的歌詞」在音樂中『開始演唱的精確秒數 (vocalStartSec)』。

嚴格要求：
1. 你的輸出必須是標準的 JSON 陣列，不可包含 markdown 等其他說明。
2. 每個物件必須包含 "slideIndex" (編號) 以及 "vocalStartSec" (這張投影片對應的第一句歌詞，在音樂中第一次發聲的精確秒數，允許帶小數點)。
3. 音樂通常有「前奏」，所以第一張投影片的 vocalStartSec 絕對大於 0（如 15.5）。
4. 本次對齊法捨棄相對時長，改用「新投影片開始播放的絕對時間點」。請專注聽歌詞發生的當下秒數。

範例輸出格式（務必純 JSON）：
[
  { "slideIndex": 1, "vocalStartSec": 15.5 },
  { "slideIndex": 2, "vocalStartSec": 45.0 }
]
`.trim();

export const ALIGN_PODCAST_PROMPT = `
我將提供一段 Podcast 的完整錄音檔，以及對應的逐字稿（內含「投影片 N」的分節標記）。
請化身精確的字幕時間軸導播，仔細聆聽這段音頻，並比對逐字稿的內容，分析出每一張投影片的對話內容在錄音檔中『開始說話的精確秒數 (vocalStartSec)』。

嚴格要求：
1. 你的輸出必須是標準的 JSON 陣列，不可包含 markdown 代碼區塊或其他文字說明。
2. 陣列內的每個物件務必包含 "slideIndex" (投影片編號) 以及 "vocalStartSec" (這張投影片的第一句話在音頻中開始發聲的精確秒數，數字，可帶小數)。
3. 若有片頭停頓，第一張投影片的 vocalStartSec 不一定為 0。講者間的停頓會真實反映在下一張 vocalStartSec 的距離上。

範例輸出格式（務必純 JSON）：
[
  { "slideIndex": 1, "vocalStartSec": 2.5 },
  { "slideIndex": 2, "vocalStartSec": 30.0 }
]
`.trim();

// ===== Parse Prompts =====
export const PARSE_PDF_PROMPT =
  '請將以下每頁投影片圖片內容整理成結構化文字，格式：\n' +
  '投影片 1: [內容]\n投影片 2: [內容]\n' +
  '以此類推，每張投影片的內容要完整詳細。純文字輸出，不使用任何 Markdown 符號。';

// ===== Podcast Prompts =====
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

export function buildPodcastPrompt(vars: {
  speaker1: string;
  speaker2: string;
  dialogueStyle: string;
  tone: string;
}) {
  return PODCAST_PROMPT_TEMPLATE(vars);
}

// ===== Lyrics Prompts =====
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

export function buildLyricsPrompt(styleLabel: string, duration: string): string {
  if (duration === LYRICS_FREE_STYLE) {
    return LYRICS_PROMPT_FREE(styleLabel);
  }
  const totalSec = parseInt(duration);
  const mm = Math.floor(totalSec / 60);
  const ss = String(totalSec % 60).padStart(2, '0');
  const endTime = `${mm}:${ss}`;
  return LYRICS_PROMPT_TIMED(styleLabel, totalSec, endTime);
}
