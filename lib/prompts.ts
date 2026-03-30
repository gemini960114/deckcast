import { DEFAULT_SPEAKER1, DEFAULT_SPEAKER2, DEFAULT_DIALOGUE_STYLE, DEFAULT_TONE } from './constants';

export const GENERATE_MUSIC_SRT = `
你將收到兩種資料：
[資料 A] 歌詞文本（可能含有 [Slide N]、[Verse]、[Chorus] 等結構標記）
[資料 B] 一個音訊檔案（AI 生成的歌曲）

【核心任務：時間定位，不是語音辨識】
- 資料 A 的歌詞文字 = 絕對正確的字幕來源，你不需要自行辨識歌詞文字
- 資料 B 的音訊 = 只用來確定每句歌詞「從哪一秒開始唱、到哪一秒結束」
- 若你聽到的音訊發音與資料 A 文字有任何出入，請永遠以資料 A 的文字為準輸出，不得自行修改歌詞

【輸出格式】：
1. 必須是純 .srt 格式，禁止夾帶 markdown 代碼區塊（禁止寫 \`\`\`srt）或問候語
2. 完全忽略所有結構標記：[Slide N]、[Verse 1]、[Chorus]、[Bridge]、[Outro] 等不可唱出的標籤一律不納入字幕
3. 純音樂段落（前奏、間奏、尾奏等無人聲時段）不產生任何字幕條目
4. 字幕文字直接使用資料 A 的原始歌詞，過長的句子可依自然停頓切分成多條
5. SRT 時間軸格式：00:00:00,000 --> 00:00:00,000

【精準定時規則】：
- 仔細聆聽人聲起始拍點作為每條字幕的開始時間
- 結束時間設定在下一句人聲開始前約 0.1 秒
- 若背景音樂較大，依歌曲節奏與段落長度合理推算，切勿捏造與音軌總長度明顯不符的時間
`.trim();

export const GENERATE_PODCAST_SRT = `
我將提供一段 Podcast 錄音檔，以及其對應的逐字稿（內含「投影片 N」的標記與講者名稱）。
請仔細聆聽對話細節，並對照我給你的逐字稿，將音檔內容翻譯成「標準、完美的 .srt 格式」對話字幕檔。

嚴格要求：
1. 你的輸出「必須」一字不漏是原始的純 .srt 格式文本，不要使用 markdown 語法 (不要包裝在 \`\`\` 裡)，也不要夾帶問候與結論。
2. 仔細剔除原本逐字稿中的講者標籤 (如 Speaker 1:、Mary老師：、男聲：) 與動作表情提示 (如 [深呼吸]、[大笑])。
3. 你必須將對話中過長的冗言贅字斷成多組 SRT 短句。一行字幕不要過長。
4. SRT 每段必須要有序號、精確起訖時間 (格式：00:00:00,000 --> 00:00:00,000) 以及該段台詞。
`.trim();

export const FIND_TRANSITIONS_PROMPT = `
你將收到兩份資料：
[資料 A] 原始歌詞文本（含有 [Slide N] 等投影片換頁標記）
[資料 B] 精確對齊的 SRT 字幕時間軸（由音訊比對 lyrics 所產生）

【核心任務】：找出每張投影片「第一句演唱歌詞」在 SRT 中的確切起始秒數（vocalStartSec）

【文字定錨法 SOP】：
步驟 1：在資料 A 找到「[Slide N]」標記，擷取該標記之後「第一句真正演唱的歌詞」前 6–8 個字，作為「定錨關鍵字」
步驟 2：完全忽略資料 A 中任何預估時間標記（如 [0:30-0:50]），這些時間值不可靠，只看文字
步驟 3：拿「定錨關鍵字」在資料 B 的 SRT 中進行地毯式比對，找到含有這段文字（或語意最相近）的字幕條目
步驟 4：取該條目的起始時間，轉換為秒數（保留一位小數），即為該投影片的 vocalStartSec

【邊界情況處理】：
- 第一張投影片：若前方有純音樂前奏（無人聲），vocalStartSec 填入第一句人聲歌詞實際出現的秒數；若人聲從開頭就開始唱（無前奏），填 0.0 是正確的，不可強行推算非零值
- 某張投影片對應的是純音樂間奏段落（SRT 中找不到對應文字）：將 vocalStartSec 設為「前一張投影片 vocalStartSec + 預估該段長度（秒）」
- 若資料 A 完全沒有任何 [Slide N] 標記：輸出空陣列 []

【輸出格式】：
1. 必須是合法的 JSON 陣列，不可包含 markdown 或任何說明文字
2. 每個物件包含 slideIndex（數字）和 vocalStartSec（秒數，保留一位小數）
3. 按 slideIndex 由小到大排序

輸出範例（絕對不可包含 \`\`\`）：
[
  { "slideIndex": 1, "vocalStartSec": 15.0 },
  { "slideIndex": 2, "vocalStartSec": 46.0 },
  { "slideIndex": 3, "vocalStartSec": 78.5 }
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
export const LYRICS_PROMPT_TIMED_OLD = (styleLabel: string, totalSec: number, endTime: string) =>
  `幫我創作 ${styleLabel} 風格歌詞，長度約 ${totalSec} 秒，並依照以下投影片內容順序編寫歌詞。

【重要格式規範】
你必須要在每個段落的上方，明確標註該段落歌詞是隸屬於哪一張投影片。
格式請完全遵守：[段落名稱] —— 對應投影片 N
(例如：[Chorus] —— 對應投影片 2)

請盡情發揮創意，但務必確保每張投影片都有被清楚標記到。`;


export const LYRICS_PROMPT_TIMED_OLD2 = (styleLabel: string, totalSec: number) =>
  `幫我創作一首 ${styleLabel} 風格的歌曲歌詞，長度約 ${totalSec} 秒。

請依照投影片內容順序發展歌詞，讓整體故事自然流動。

請使用常見歌曲段落（Intro、Verse、Chorus、Bridge）。
每個段落請標註對應時間軸與投影片頁碼，例如：[0:00 - 0:10] [Verse 1] [Slide 2]。
`;


export const LYRICS_PROMPT_TIMED = (styleLabel: string, totalSec: number) =>
  `幫我創作一首 ${styleLabel} 風格的歌曲歌詞，總長度約 ${totalSec} 秒。

【輸出格式要求】（請嚴格遵守）：
請先輸出歌曲基本資訊，格式如下：

歌曲名稱：【自行創作一個有創意的標題】
風格：${styleLabel}
總時長：約 ${totalSec} 秒
節奏：請自行設定 BPM（例如 90 BPM / 120 BPM）
關鍵元素：列出 3-5 個音樂元素（例如：808 重低音、Hi-hats、合成器等）

---
接著再輸出完整歌詞內容。

【歌詞要求】：
1. 使用常見段落：Intro、Verse、Chorus、Bridge、Outro
2. 每段都必須包含：
   - 時間軸（例如 [0:00 - 0:10]）
   - 段落名稱
   - 投影片頁碼（例如 [Slide 2]）
3. 所有段落時間加總需接近 ${totalSec} 秒（誤差 ±5 秒內）
4. 歌詞需依照投影片順序發展，故事自然流動
5. 可以加入旁白、音效描述、角色對話（增加沉浸感）
6. 風格要符合 ${styleLabel}

【格式範例】：
歌曲名稱：【範例標題】
風格：XXX
總時長：約 XX 秒
節奏：100 BPM
關鍵元素：元素1、元素2、元素3

[0:00 - 0:10] Intro [Slide 1]
（音效描述）
歌詞...

請嚴格按照上述格式輸出，不要省略標題區塊，時間軸必須合理分配。
`;

export function buildLyricsPrompt(styleLabel: string, duration: string): string {
  // 提取數字部分，解析失敗則給予預設值 90 秒
  const parsedSec = parseInt(duration, 10);
  const totalSec = isNaN(parsedSec) ? 90 : parsedSec;

  const mm = Math.floor(totalSec / 60);
  const ss = String(totalSec % 60).padStart(2, '0');
  const endTime = `${mm}:${ss}`;

  return LYRICS_PROMPT_TIMED(styleLabel, totalSec);
}
