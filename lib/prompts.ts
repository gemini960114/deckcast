import { DEFAULT_SPEAKER1, DEFAULT_SPEAKER2, DEFAULT_DIALOGUE_STYLE, DEFAULT_TONE } from './constants';

export const GENERATE_MUSIC_SRT = `
我將提供一首 AI 生成的歌曲音檔，以及其對應的歌詞本（可能內含「投影片 N」或音樂結構標記）。
請仔細聆聽整首歌發音，比對這份歌詞本，為我產出一份「標準、嚴謹的 .srt 字幕格式」腳本。

嚴格要求：
1. 你的輸出「必須」一字不漏是原始的純 .srt 格式，不能夾帶任何 markdown 代碼區塊 (不要寫 \`\`\`srt 的包裝)，或是其餘問候語說明詞。
2. 忽略或清掉任何「投影片 N」、「Speaker」、「Male/Female voice」或是「[Verse 1]」、「[Chorus]」這類不具有演唱意義的段落提示標籤字眼，絕對不要把它們變成字幕。
3. 把過長的句子分段，確保每句字幕在畫面上短暫且易讀。
4. SRT 的時間軸格式必須是 00:00:00,000 --> 00:00:00,000。
5. 【重要】請盡可能精確對齊人聲開始與結束的節拍。如果背景樂器過大導致難以聽清精確的毫秒，請根據歌曲的節奏與段落結構進行合理且平滑的時間推算，切勿隨意捏造與音軌總長度明顯不符的時間。
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
我將給你兩份資料：
[資料 A] 原始文稿 (可能是 Podcast 對白或歌曲歌詞，內含「對應投影片 N」或「投影片 N：」等標記)。
[資料 B] 對剛剛這份文稿所聽寫打好的「超準確 SRT 字幕時間軸」。

你的核心目標：找出「每一張投影片的第一句話文字」，對應在 SRT (資料 B) 裡面『到底是在哪一秒被唱出來/唸出來的 (vocalStartSec)』。

【極度重要：文字定錨法 SOP】
步驟 1：在 [資料 A] 尋找對應第 N 張投影片的標記 (可能寫做「對應投影片 N」、「投影片 N：」等)，並擷取這頁中「真正開口的第一句話文字」（例如：這枚 Power Coin 閃爍著橘色光芒）。
步驟 2：完全忽略 [資料 A] 段落旁附帶的預估時間標記（如 [0:30-0:50]），因為 AI 歌手經常脫稿演出，那些預估時間是毫無參考價值的假資訊，看字不看時間！
步驟 3：拿著剛剛擷取的那句文字，去 [資料 B] 的 SRT 裡面進行地毯式檢索，找出這句話實際被唱/唸出來的 SRT 區塊（如果找不到 100% 一模一樣的句子，請找音近或語意最近的句子充當定錨點）。
步驟 4：抓取該 SRT 區塊的第一個時間軸起點（如 00:00:46,000），將其轉換為秒數（46.0），這才是該投影片正確無誤的真理時間 (vocalStartSec)。

嚴格要求：
1. 你的輸出必須是一個標準的 JSON 陣列，不可包含 markdown 語法或其他說明字眼。
2. 每個物件必須包含 "slideIndex" (投影片編號，必須是數字) 以及 "vocalStartSec" (這頁第一句話在 SRT 中開始的確切秒數)。
3. 第一張投影片如果有前奏音樂，可能要等 15 秒才會有第一句話被唸出來，請精確按照 SRT 推算。

輸出範例 (絕對不可包含 \`\`\`):
[
  { "slideIndex": 1, "vocalStartSec": 2.5 },
  { "slideIndex": 2, "vocalStartSec": 46.0 }
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
export const LYRICS_PROMPT_TIMED = (styleLabel: string, totalSec: number, endTime: string) =>
  `幫我創作 ${styleLabel} 風格歌詞，長度約 ${totalSec} 秒，並依照以下投影片內容順序編寫歌詞。

【重要格式規範】
你必須要在每個段落的上方，明確標註該段落歌詞是隸屬於哪一張投影片。
格式請完全遵守：[段落名稱] —— 對應投影片 N
(例如：[Chorus] —— 對應投影片 2)

請盡情發揮創意，但務必確保每張投影片都有被清楚標記到。`;

export function buildLyricsPrompt(styleLabel: string, duration: string): string {
  // 提取數字部分，解析失敗則給予預設值 90 秒
  const parsedSec = parseInt(duration, 10);
  const totalSec = isNaN(parsedSec) ? 90 : parsedSec; 
  
  const mm = Math.floor(totalSec / 60);
  const ss = String(totalSec % 60).padStart(2, '0');
  const endTime = `${mm}:${ss}`;
  
  return LYRICS_PROMPT_TIMED(styleLabel, totalSec, endTime);
}
