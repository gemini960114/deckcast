import { DEFAULT_SPEAKER2, CONTENT_LANGUAGE_PROMPT_LABEL, DEFAULT_CONTENT_LANGUAGE, NARRATION_LENGTH_PRESETS, DEFAULT_NARRATION_LENGTH_PRESET, ALLOWED_AUDIO_TAGS } from './constants';
import type { NarrationMode, ContentLanguage, NarrationLengthPreset } from './types';

export const GENERATE_MUSIC_SRT = `
你將收到兩種資料：
[資料 A] 歌詞文本（可能含有 [Slide N]、[Verse]、[Chorus] 等結構標記）
[資料 B] 一個音訊檔案（AI 生成的歌曲）

【核心任務：時間定位，不是語音辨識】
- 資料 A 的歌詞文字 = 正確文字來源，供你參考校正文句，不可自行改寫、增刪、替換
- 資料 B 的音訊 = 主要依據，必須用來定位每句歌詞的開始與結束時間
- 你不可使用資料 A 去猜測時間；時間必須依據資料 B 的實際音訊判定
- 若你聽到的音訊發音與資料 A 文字有任何出入，請以資料 A 的文字校正字幕文字，但時間仍必須依音訊決定

【輸出格式】
1. 只能輸出合法 JSON 陣列，不可輸出 markdown、說明、問候語
2. 每個物件格式固定為：
   { "id": 1, "start": 0.5, "end": 3.2, "text": "歌詞內容" }
3. id 必須從 1 開始遞增
4. start/end 以秒數表示，可含小數
5. start 必須小於 end
6. text 不可為空字串

【字幕規則】
1. 完全忽略所有結構標記：[Slide N]、[Verse]、[Chorus]、[Bridge]、[Outro] 等不可唱出的標籤
2. 純音樂段落（前奏、間奏、尾奏、無人聲區段）不產生字幕條目
3. 只保留主旋律或最主要的人聲內容；和聲、背景疊唱若會造成混亂可忽略
4. 過長句子可依自然停頓、換氣、節拍停頓切成多條，但不可過碎
5. 每條字幕請盡量覆蓋完整可感知的人聲尾音，但不得壓到下一句明顯起點

【品質要求】
1. 不得漏掉明顯的主旋律句子
2. 時間必須嚴格遞增，不可重疊，不可倒退
3. 若音訊較模糊，仍請以資料 A 的文字為準，輸出最合理的時間範圍
`.trim();

export const GENERATE_PODCAST_SRT = `
你將收到兩份資料：
[資料 A] Podcast 音訊檔案
[資料 B] Podcast 參考逐字稿或腳本（可能含投影片標記與講者名稱）

【核心任務】
請直接聆聽資料 A 的音訊，輸出一份時間對齊的字幕 JSON。
資料 B 只作為校正專有名詞、課程術語與上下文的參考，不可直接照抄，也不可使用資料 B 來猜測時間。

【重要規則】
1. 請依據音訊中實際聽到的內容決定每一條字幕文字。
2. 若資料 B 與實際音訊不一致，優先保留實際音訊。
3. 請移除沒有真的念出的講者標籤，例如 Speaker 1:、Speaker 2:、Mary老師：、阿哲：。
4. 請在自然停頓處切句，避免單條字幕過長。
5. 時間必須嚴格遞增，不可重疊，不可倒退。
6. 純空白、笑聲、沒有實際內容的填充詞可略過。

【輸出格式】
1. 只能輸出合法 JSON 陣列，不可輸出 markdown 或說明文字。
2. 每個物件格式固定為：
   { "id": 1, "start": 0.5, "end": 3.2, "text": "字幕內容" }
3. id 必須從 1 開始遞增。
4. start/end 以秒數表示，可含小數。
5. start 必須小於 end。
6. text 不可為空字串。
`.trim();

export const FIND_TRANSITIONS_PROMPT = `
你將收到兩份資料：
[資料 A] 視覺段落摘要 JSON 陣列。每個物件都包含：
- cueIndex（段落序號，從 1 開始）
- sectionLabel（段落名稱，如 Intro、Verse 1、Chorus）
- slideIndex（對應的投影片編號，每個段落都有對應的投影片）
- previousLastLine
- currentFirstLine
- currentSecondLine
- currentLastLine
[資料 B] 已完成時間對齊的字幕 JSON 陣列，每條字幕都有 id / start / end / text

【核心任務】：找出每個視覺段落應該從哪一條字幕開始顯示

【工作原則】
1. 你的工作是做「文字對文字」與「上下文順序」匹配，不是估算秒數
2. 若歌詞有重複副歌、相似句型、重複句尾，必須根據前後文順序判斷正確的那一次
3. 優先同時參考：
   - 上一段最後一句
   - 本段第一句
   - 本段第二句
4. currentFirstLine 與 currentSecondLine 是最重要的定錨文字；若兩者都為 null，代表此段可能沒有可唱歌詞
5. 若本段對應純音樂間奏，且資料 B 找不到可靠字幕，startSrtId 可填 null
6. startSrtId 應盡量保持遞增（歌曲時間是單向前進的）
7. 你只需要找出「每個段落開始時」對應的字幕 id，不要輸出秒數
8. 不可修改 cueIndex，不可省略任何 cueIndex

【輸出格式】
1. 只能輸出合法 JSON 陣列，不可包含 markdown 或任何說明文字
2. 每個物件格式：
   { "cueIndex": 1, "slideIndex": 1, "startSrtId": 3, "confidence": 0.95, "matchReason": "根據本段第一句與前後文匹配" }
3. confidence 範圍 0 到 1
4. 若無法可靠對應，startSrtId 填 null，confidence 降低
5. 請為每一個視覺段落都輸出一個物件，cueIndex 必須連續且完整
`.trim();

export const REFINE_MUSIC_SRT_TEXT_PROMPT = `
你將收到三份資料：
[資料 A] 音訊檔案
[資料 B] Whisper 產出的逐段轉錄結果（含 id / start / end / text）
[資料 C] 參考歌詞文本（文字正確來源，已移除中括號標記）

【核心任務】
請直接聆聽資料 A 的音訊，並保留資料 B 每一段的 id 與分段順序，只修正每一段的文字內容。
時間切段以資料 B 為準，文字判定以「實際聽到的音訊」為主，資料 C 只作為正確歌詞參考。

【重要規則】
1. 只允許修正文字，不可改變段數，不可新增段落，不可刪除段落。
2. 每個 id 都必須輸出。
3. 請先依據資料 A 實際聽到的歌聲決定這一段唱了什麼，再用資料 C 校正錯字、專有名詞與語句。
4. 不可直接照抄資料 C；若資料 C 與實際音訊不符，優先保留實際聽到的內容。
5. 若資料 B 某段是 ad-lib、呼喊、括號內演唱詞，而音訊中也確實唱出來，請保留並修正成合理版本。
6. 若無法確定，就保留最接近資料 B 且符合音訊的內容，不要憑空捏造新句子。

【輸出格式】
只能輸出合法 JSON 陣列，不可包含 markdown 或任何說明文字。
每個物件格式：
{ "id": 1, "text": "修正後的文字" }
`.trim();

export const REFINE_PODCAST_SRT_TEXT_PROMPT = `
你將收到三份資料：
[資料 A] Podcast 音訊檔案
[資料 B] Whisper 產出的逐段轉錄結果（含 id / start / end / text）
[資料 C] Podcast 參考逐字稿或腳本

【核心任務】
請直接聆聽資料 A 的音訊，並保留資料 B 每一段的 id 與分段順序，只修正每一段的文字內容。
時間切段以資料 B 為準，文字判定以「實際聽到的音訊」為主，資料 C 只作為參考校正。

【重要規則】
1. 只允許修正文字，不可改變段數，不可新增段落，不可刪除段落。
2. 每個 id 都必須輸出。
3. 請先依據資料 A 實際聽到的語音決定這一段說了什麼，再用資料 C 校正專有名詞、講義術語與明顯錯字。
4. 不可直接照抄資料 C；若資料 C 與實際音訊不符，優先保留實際聽到的內容。
5. 請移除不必要的講者標籤，例如 Speaker 1:、Speaker 2:、Mary老師：、阿哲：，除非音訊中真的把這些標籤念出來。
6. 若無法確定，就保留最接近資料 B 且符合音訊的內容，不要憑空捏造新句子。

【輸出格式】
只能輸出合法 JSON 陣列，不可包含 markdown 或任何說明文字。
每個物件格式：
{ "id": 1, "text": "修正後的文字" }
`.trim();

export const FIND_PODCAST_TRANSITIONS_PROMPT = `
你將收到兩份資料：
[資料 A] 原始文稿（含有「投影片 N」標記）
[資料 B] 已完成時間對齊的字幕 JSON 陣列，每條字幕都有 id / start / end / text

【核心任務】：找出每張投影片應該從哪一條字幕開始顯示

【工作原則】
1. 你的工作是做「文字對文字」與「上下文順序」匹配，不是估算秒數
2. 優先找出每張投影片標記後，真正開始講解該頁內容的第一句關鍵內容
3. 開場寒暄、承上啟下的過渡語、上一頁收尾句，不應提早觸發換頁
4. 若文字有些微差異，請依上下文語意判斷最合理的字幕條目
5. 請依投影片順序輸出，slideIndex 應遞增，startSrtId 也應盡量保持遞增
6. 若某頁找不到可靠字幕條目，startSrtId 可填 null

【輸出格式】
1. 只能輸出合法 JSON 陣列，不可包含 markdown 或任何說明文字
2. 每個物件格式：
   { "slideIndex": 1, "startSrtId": 12, "confidence": 0.92, "matchReason": "本頁第一個重點句開始出現在字幕 12" }
3. confidence 範圍 0 到 1
`.trim();


// ===== Parse Prompts =====
export const PARSE_PDF_PROMPT =
  '請將以下每頁投影片圖片內容整理成結構化文字，格式：\n' +
  '投影片 1: [內容]\n投影片 2: [內容]\n' +
  '以此類推，每張投影片的內容要完整詳細。純文字輸出，不使用任何 Markdown 符號。';

// ===== Narration Prompts (F: three-mode system) =====

/** 產生放在 narration prompt 最前面的語言指定區塊 */
function buildLanguageBlock(language: ContentLanguage): string {
  const langLabel = CONTENT_LANGUAGE_PROMPT_LABEL[language];
  return `【語言指定】
以下所有實際講話內容必須使用 ${langLabel} 撰寫。
主體內容不得改用其他語言作為主要輸出；可保留極少量不可避免的專有名詞原文。
但以下固定結構標記不論內容語言為何，均必須維持原樣，不可翻譯：
- 風格:
- 投影片 N:（N 為數字）
- Speaker 1:
- Speaker 2:

錯誤範例：Slide 1:、スライド 1:、슬라이드 1:（這些都是錯誤的）
正確範例：投影片 1:（即使內容是 ${langLabel} 也一樣）
Do not translate these markers into any other language.

`;
}

/** 產生旁白長度要求區塊，插入三個 narration template */
function buildNarrationLengthBlock(preset: NarrationLengthPreset, note?: string): string {
  const promptLabel =
    NARRATION_LENGTH_PRESETS.find(p => p.value === preset)?.promptLabel
    ?? '每張投影片約 30 至 45 秒';

  let block = `【長度要求】
- 每張投影片腳本長度目標：${promptLabel}
- 請依照內容複雜度自然微調：簡單頁可略短，重點頁可略長
- 請維持整體節奏穩定，避免長度差異過大`;

  if (note?.trim()) {
    block += `\n\n【使用者補充偏好】\n${note.trim()}`;
  }

  return block;
}

/** 產生放在 lyrics prompt 結尾的語言指定區塊（比腳本更嚴格，en 與非英語分支處理） */
function buildLyricsLanguageBlock(language: ContentLanguage): string {
  const langLabel = CONTENT_LANGUAGE_PROMPT_LABEL[language];

  if (language === 'en') {
    return `\n【歌詞語言指定】
所有實際演唱歌詞必須使用 ${langLabel} 撰寫。
${langLabel} 必須是主體語言；可保留極少量不可避免的專有名詞、品牌名、術語原文，但不可讓其他語言佔主體。
段落標記如 [Verse 1] [Slide 2]、[Chorus]、[Guitar Solo] 必須維持既有格式，不可翻譯。
不可唱的提示（以中括號標示）維持原有格式，不影響實際演唱內容的語言要求。
`;
  }

  // zh-TW / ja / ko：明確禁止英文成為主體
  return `\n【歌詞語言指定】
所有實際演唱歌詞必須使用 ${langLabel} 撰寫。
${langLabel} 必須是主體語言，不可讓英文成為主體歌詞。
可保留極少量不可避免的專有名詞、品牌名、術語原文，但外語不可佔主體。
段落標記如 [Verse 1] [Slide 2]、[Chorus]、[Guitar Solo] 必須維持既有格式，不可翻譯。
不可唱的提示（以中括號標示）維持原有格式，不影響實際演唱內容的語言要求。
Do not use English as the primary language for the sung lyrics.
`;
}

function buildAudioTagsBlock(mode: NarrationMode): string {
  const tagList = ALLOWED_AUDIO_TAGS.map(t => `[${t}]`).join('、');
  const modeNote = mode === 'duo'
    ? '每個 Speaker 輪次最多 1 個 tag，優先使用 [neutral]、[enthusiasm]、[curiosity]，避免過於戲劇化的非語言 tag。'
    : mode === 'solo_story'
    ? '可使用 [curiosity]、[tension]、[whispers]、[long pause] 以增加敘事感，但不要過量。'
    : '偏保守，優先使用 [neutral]、[interest]、[curiosity]、[slow]、[short pause]。';

  return `
【Audio Tags 規則】
- 本次腳本需在適當位置加入語氣標籤（audio tags）
- 允許使用的 tags（僅限以下白名單）：${tagList}
- 規則：
  1. tags 必須放在 Speaker 台詞行內，不可放在「風格:」或「投影片 N:」行
  2. 不可連續放兩個 tag，tag 與正文之間必須有文字或標點隔開
  3. 每句最多 1 個 tag
  4. 每張投影片最多 2 到 3 個 tag
  5. 若內容不適合加 tag，寧可不加，不要硬插
  6. ${modeNote}
`;
}

export const DUO_PODCAST_PROMPT_TEMPLATE = (vars: {
  speaker1: string;
  speaker2: string;
  dialogueStyle: string;
  tone: string;
  language: ContentLanguage;
  narrationLengthPreset: NarrationLengthPreset;
  narrationLengthNote: string;
}) =>
  `${buildLanguageBlock(vars.language)}我想製作一個雙人對談節目，介紹以下每一張投影片內容。
${buildNarrationLengthBlock(vars.narrationLengthPreset, vars.narrationLengthNote)}

設定如下：
- 主持人1 (Speaker 1) 的人設：${vars.speaker1}
- 主持人2 (Speaker 2) 的人設：${vars.speaker2}
- 對話風格：${vars.dialogueStyle}
- 節目基調：${vars.tone}

【極度重要的格式規定】
無論兩位主持人的名字叫什麼，講話前方的發言者標籤必須且只能使用 "Speaker 1:" 與 "Speaker 2:"。
絕對不可以使用角色名字作為標籤。

請嚴格依照以下格式輸出：

風格: [請依據內容產生適合的朗讀風格說明]

投影片 1：[標題]
Speaker 1: [台詞內容，可以在台詞內自稱名字]
Speaker 2: [台詞內容...]
Speaker 1: [台詞內容...]
[視內容繼續對話]

每張投影片請分段呈現。

【結尾要求】
最後一張投影片請自然收束，不要突然中斷。
收尾方式可依內容需要自然選擇：
- 一句總結
- 一句共鳴
- 一句驚嘆
- 若主題適合，也可用一個開放式問題作結

不要加「感謝收聽」或制式節目尾句。`.trim();

export const SOLO_EXPLAINER_PROMPT_TEMPLATE = (vars: {
  speaker1: string;
  dialogueStyle: string;
  tone: string;
  language: ContentLanguage;
  narrationLengthPreset: NarrationLengthPreset;
  narrationLengthNote: string;
}) =>
  `${buildLanguageBlock(vars.language)}我想製作一段單人講解音訊，依序介紹以下每一張投影片內容。
${buildNarrationLengthBlock(vars.narrationLengthPreset, vars.narrationLengthNote)}

設定如下：
- 講者人設：${vars.speaker1}
- 講解風格：${vars.dialogueStyle}
- 整體基調：${vars.tone}

【極度重要的格式規定】
請使用單一講者格式，不要生成對話，不要出現第二角色。
講話前方的標籤請固定使用 "Speaker 1:"。

請嚴格依照以下格式輸出：

風格: [請依據內容產生適合的朗讀風格說明]

投影片 1：[標題]
Speaker 1: ...

投影片 2：[標題]
Speaker 1: ...

每張投影片請分段呈現。

【寫作要求】
- 以清楚、穩定、條理分明的方式講解
- 避免不必要的自問自答
- 避免過度表演化的語氣
- 內容要像專業講者在解說，而不是主持人聊天

【結尾要求】
最後一張投影片請自然收束，不要突然中斷。
優先用一句總結、收束重點或平穩落點作結。
不要強制拋問題，也不要加「感謝收聽」這類制式結尾。`.trim();

export const SOLO_STORY_PROMPT_TEMPLATE = (vars: {
  speaker1: string;
  dialogueStyle: string;
  tone: string;
  language: ContentLanguage;
  narrationLengthPreset: NarrationLengthPreset;
  narrationLengthNote: string;
}) =>
  `${buildLanguageBlock(vars.language)}我想製作一段單人敘事音訊，依序介紹以下每一張投影片內容。
${buildNarrationLengthBlock(vars.narrationLengthPreset, vars.narrationLengthNote)}

設定如下：
- 敘事者人設：${vars.speaker1}
- 敘事風格：${vars.dialogueStyle}
- 整體基調：${vars.tone}

【極度重要的格式規定】
請使用單一講者格式，不要生成對話，不要出現第二角色。
講話前方的標籤請固定使用 "Speaker 1:"。

請嚴格依照以下格式輸出：

風格: [請依據內容產生適合的朗讀風格說明]

投影片 1：[標題]
Speaker 1: ...

投影片 2：[標題]
Speaker 1: ...

每張投影片請分段呈現。

【寫作要求】
- 可以有畫面感、節奏感與情境鋪陳
- 可以更口語、更流動，但不要變成雙人對話
- 適合導讀、故事、人物、歷史脈絡或敘事型介紹

【結尾要求】
最後一張投影片請自然收束，不要突然中斷。
優先用一句有餘韻的敘事、感受或畫面落點收尾。
若主題非常適合，也可保留少量留白，但不要固定用開放式提問，也不要加制式結尾。`.trim();

export function buildNarrationPrompt(params: {
  mode: NarrationMode;
  speaker1: string;
  speaker2?: string;
  dialogueStyle: string;
  tone: string;
  language?: ContentLanguage;
  narrationLengthPreset?: NarrationLengthPreset;
  narrationLengthNote?: string;
  audioTagsEnabled?: boolean;
}): string {
  const language = params.language ?? DEFAULT_CONTENT_LANGUAGE;
  const resolvedPreset = params.narrationLengthPreset ?? DEFAULT_NARRATION_LENGTH_PRESET;
  const resolvedNote = params.narrationLengthNote ?? '';
  const audioTagsSuffix = params.audioTagsEnabled ? buildAudioTagsBlock(params.mode) : '';

  switch (params.mode) {
    case 'duo':
      return DUO_PODCAST_PROMPT_TEMPLATE({
        speaker1: params.speaker1,
        speaker2: params.speaker2 ?? DEFAULT_SPEAKER2,
        dialogueStyle: params.dialogueStyle,
        tone: params.tone,
        language,
        narrationLengthPreset: resolvedPreset,
        narrationLengthNote: resolvedNote,
      }) + audioTagsSuffix;
    case 'solo_explainer':
      return SOLO_EXPLAINER_PROMPT_TEMPLATE({
        speaker1: params.speaker1,
        dialogueStyle: params.dialogueStyle,
        tone: params.tone,
        language,
        narrationLengthPreset: resolvedPreset,
        narrationLengthNote: resolvedNote,
      }) + audioTagsSuffix;
    case 'solo_story':
      return SOLO_STORY_PROMPT_TEMPLATE({
        speaker1: params.speaker1,
        dialogueStyle: params.dialogueStyle,
        tone: params.tone,
        language,
        narrationLengthPreset: resolvedPreset,
        narrationLengthNote: resolvedNote,
      }) + audioTagsSuffix;
  }
}

// ===== Lyrics Prompts =====


export const LYRICS_PROMPT_TIMED = (styleLabel: string, totalSec: number) =>
  `幫我創作一首 ${styleLabel} 風格的歌曲歌詞，總長度約 ${totalSec} 秒。

【核心目標】
- 請優先確保格式穩定、可解析，其次才是文采變化
- 歌詞段落與投影片的對應代表「內容主題」，不代表播放順序
- 每個段落都必須有 [Slide N]，不允許留空或使用其他標記
- 不要自行加入任何時間軸標記，例如 [0:00 - 0:10]

【輸出格式要求】（這是系統運作的硬性規則，請絕對嚴格遵守）
請先輸出歌曲基本資訊，格式如下：

歌曲名稱：【請自行創作】
風格：${styleLabel}
總時長：約 ${totalSec} 秒
節奏：【請自行設定 BPM】
關鍵元素：【列出 3-5 個音樂元素】

---
接著再輸出完整歌詞內容。

【歌詞段落格式硬性規定】
1. 每一個大段落的標題行，必須且只能使用以下格式：
[段落名稱] [Slide N]

2. 段落標題行中，除了「段落名稱」與 [Slide N] 之外，不可加入任何其他文字、符號、說明或時間資訊。

3. 正確範例：
[Intro] [Slide 1]
[Verse 1] [Slide 2]
[Chorus] [Slide 3]
[Bridge] [Slide 3]
[Chorus] [Slide 3]

4. 錯誤範例：
[0:00 - 0:10] [Verse 1] [Slide 2]
Intro [Slide 1]
[Verse 1][Slide 2]
[Verse 1] (Slide 2)
[Verse 1] [Slide 1,2]
[Bridge] [No Slide]

【Slide 標記規則】
1. 每個段落標題必須包含一個 [Slide N]，不允許省略或使用 [No Slide]
2. [Slide N] 代表此段歌詞主要對應第 N 張投影片的內容，不代表播放順序
3. 同一張投影片可以重複出現，副歌回唱時應重複使用相同的 [Slide N]
4. 投影片編號可以回跳，也可以跳過某些頁面
5. 若第一段無法判斷對應哪一張，預設使用 [Slide 1]
6. 若中途某段無法判斷，沿用上一段的 [Slide N]
7. 不必強制讓每張投影片都至少出現一次

【不可唱提示規則】
1. 所有「不會被唱出來的提示詞」都必須單獨寫在英文中括號內
2. 這類提示只可使用中括號 []，絕對禁止使用圓括號 () 或大括號 {}
3. 中括號內文字一律視為不可唱提示，不可把真正歌詞寫在中括號內

正確範例：
[Guitar Solo]
[Fade out]
[Heartbeat sound effect]

錯誤範例：
（電吉他獨奏）
{Fade out}
[我好想你]

【歌詞內容規則】
1. 歌詞必須是純文字，不可使用 Markdown
2. 絕對不可使用粗體、斜體、程式碼區塊、清單符號等 Markdown 語法
3. 不可出現 **文字**、*文字*、# 標題、\`\`\`、- 清單 這類格式
4. 歌詞需符合 ${styleLabel} 的風格
5. 歌詞總體長度與演唱密度應接近 ${totalSec} 秒
6. 可使用常見段落名稱，例如 Intro、Verse、Pre-Chorus、Chorus、Bridge、Outro

【輸出範例】
歌曲名稱：細胞的秘密
風格：${styleLabel}
總時長：約 ${totalSec} 秒
節奏：100 BPM
關鍵元素：吉他、重低音、合成器

[Intro] [Slide 1]
[Heartbeat sound effect]
第一句歌詞
第二句歌詞

[Verse 1] [Slide 1]
第三句歌詞
第四句歌詞

[Chorus] [Slide 3]
第五句歌詞
第六句歌詞

[Bridge] [Slide 3]
第七句歌詞

[Chorus] [Slide 3]
第五句歌詞（重複副歌）
第六句歌詞

請嚴格依照上述格式輸出，不要加入任何額外說明、註解、Markdown 或時間軸標記。`;

export function buildLyricsPrompt(styleLabel: string, duration: string, language?: ContentLanguage): string {
  const parsedSec = parseInt(duration, 10);
  const totalSec = isNaN(parsedSec) ? 90 : parsedSec;

  const lang = language ?? DEFAULT_CONTENT_LANGUAGE;
  const base = LYRICS_PROMPT_TIMED(styleLabel, totalSec);

  return base + buildLyricsLanguageBlock(lang);
}
