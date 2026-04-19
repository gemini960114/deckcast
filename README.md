# DeckCast

一個 AI 驅動的內容生成工具，將 PDF 簡報自動轉換為 Podcast 音訊、AI 歌曲與同步簡報。

👉 **線上展示：[DeckCastAI 簡報語音生成器 - 讓簡報開口說話 · AI 簡報語音生成器](https://deckcast.biobank.org.tw/)**

---

## 產品簡介

上傳一份 3-25 頁的 PDF 投影片，系統自動完成以下所有工作：

1. 解析每張投影片內容
2. 生成雙人 Podcast 對話文稿
3. 生成或上傳 Podcast 音訊
4. 呼叫 AI 將 Podcast 音訊精準對齊成同步簡報
5. 生成指定風格的歌詞
6. 生成或上傳歌曲音訊
7. 呼叫 AI 將歌曲音訊精準對齊成同步簡報

所有生成結果可逐一下載，簡報播放時與音訊同步啟動即可對齊；也支援下載 SRT 與手動微調 offset 後重新封裝 PPTX，套用後 SRT 時間戳、PPTX 轉場與 MP4 影片均會同步更新。

---

## 主要功能

### PDF 解析
- 支援純文字與圖片型 PDF
- 由 Gemini AI 原生解析每頁內容，無需額外 OCR 工具
- 解析完成後顯示投影片清單供確認

### Podcast 文稿生成
- 支援三種語音表達模式，可在 Step 0 選擇：
  - **雙人對談（duo）**：Speaker 1 / Speaker 2 交替，自然收尾（原預設）
  - **單人講解（solo_explainer）**：僅 Speaker 1，教學風格，清晰穩定
  - **單人說故事（solo_story）**：僅 Speaker 1，敘事風格，情境鮮明
- 每張投影片約 30–60 秒內容量，並依照模式與複雜度自然調整長度
- 可自訂說話者角色（單人模式僅 Speaker 1）、對話形式與語氣風格
- 切換模式時，文稿與後續歌詞／SRT／timings 會自動清除，避免舊模式內容殘留
- **Audio Tags（語氣標籤）**：Step 2 生成區提供「自動加入語氣標籤（Audio Tags）」checkbox（預設關閉）
  - 勾選後，重新生成的腳本會依模式自動插入少量白名單語氣 tags，如 `[enthusiasm]`、`[short pause]`
  - 白名單（12 個）：`[neutral]` / `[enthusiasm]` / `[interest]` / `[curiosity]` / `[positive]` / `[tension]` / `[slow]` / `[fast]` / `[short pause]` / `[long pause]` / `[whispers]` / `[laughs]`
  - Tags 只出現在 `Speaker` 台詞行，不影響 `風格:` 或 `投影片 N:` 等 parser 結構標記
  - Step 3 TTS 與 Step 2「複製全文」均保留 tags 不清除
  - 建議搭配 `gemini-3.1-flash-tts-preview` 使用；其他 TTS 模型亦可運作，效果未保證
  - `audioTagsEnabled` 儲存於 `GenerationRecord`，重新載入歷史紀錄後可還原；切換後立即持久化
- **生成後可手動編輯**：文稿生成完成後，Step 2 會顯示「編輯腳本」按鈕，可直接在前端修改文稿內容
  - 編輯期間使用暫存草稿（`scriptDraft`），取消不影響正式腳本
  - 儲存後會自動清除所有依賴腳本的下游產物（Podcast 音訊、PPTX、SRT、timings、video）；所有模式均同時清除歌詞與音樂系列成品（plan_A 後統一行為，不再區分 duo/solo）
  - 儲存後同步更新 `scriptGeneratedAt` 時間戳，確保下載命名標籤正確反映最新版本
  - 編輯模式開啟時，Step 3~7 全部禁用，避免 draft 與 live 腳本並存時誤操作後續流程

### 歌詞生成（14 種風格可選）
- 嚴格依照投影片段落順序編排，每個段落必須有對應的 `[Slide N]` 標記（不允許 `[No Slide]`）
- 每段落使用機器解析友善格式：`[段落名稱] [Slide N]`；允許多個段落對應同一張投影片（重複或回溯）
- 不允許 AI 自行加入時間戳記，最終時間由 Whisper/Gemini 實際聆聽音訊後決定
- **歌詞內容依據（Step 5 可選）**：可選「依講稿生成」（預設，歌詞貼近 Step 2 敘事）或「依投影片生成」（歌詞聚焦投影片重點）；切換時會清除現有歌詞與音樂鏈
- **生成後可手動後製**：歌詞生成完成後，Step 5 顯示「編輯歌詞」按鈕，可直接修改；儲存後清除 Music 鏈下游（musicBlob / SRT / timings / PPTX / MP4）
- 採用「唱片發行規格」預設時長，提供更細膩的樂理結構支持：
  - **Short（精華版）– 60s**
  - **Standard（主打歌 ⭐）– 105s**（系統預設）
  - **Full（完整版）– 135s**
  - **Pro（演唱會版）– 180s**
- 內部採用歌曲結構與時間軸「雙層控制結構 (Dual-Layer Prompt)」與優先權排序指令，強迫 AI 服從數學約束，抗幻覺能力強。

**可選風格：**

| # | 風格 | 方向 |
|---|---|---|
| 1 | K-POP Dance Pop | 偏短 |
| 2 | C-POP 國風電子 | 基準 |
| 3 | 台灣抒情流行 | 偏長 |
| 4 | J-POP / City Pop | 基準 |
| 5 | EDM / Synth-Pop | 偏短 |
| 6 | Hip-Hop / Trap | 偏短 |
| 7 | R&B / Neo Soul | 偏長 |
| 8 | Pop Rock | 基準 |
| 9 | Indie Folk | 偏長 |
| 10 | 歌劇 / Musical Theater | 偏長 |
| 11 | Reggaeton | 偏短 |
| 12 | Jazz / Swing | 基準 |
| 13 | Disco Funk | 偏短 |
| 14 | Cinematic / Epic Orchestra | 偏長 |

### Podcast 音訊生成
- 使用 Gemini Multi-speaker TTS
- 雙人模式：Speaker 1 / 2 各自對應不同聲音（可於設定選擇）
- 單人模式：僅使用 Speaker 1 聲音，TTS payload 自動調整為單聲道設定
- 也支援上傳外部產製音訊（`mp3 / wav / m4a / aac`，50MB 以內）
- **上傳音訊自動標準化**：上傳 `wav / m4a / aac` 時，系統自動呼叫後端 FFmpeg 將音訊轉換為標準 MP3（mono / 24000 Hz / 128 kbps），改善外部音檔 seek 穩定性；`mp3` 來源直接使用，不重編碼
- 下載時會保留與原始 blob 相符的副檔名
- 若想在外部先生成再回來上傳，建議使用 [Google AI Studio Speech](https://aistudio.google.com/generate-speech?model=gemini-2.5-pro-preview-tts)
- **TTS 生成模式（使用者可選）**：Step 3 API 生成區提供下拉選單，讓使用者選擇生成策略：
  - `不分段（音色較一致）`（預設）：整段腳本一次送 TTS，聲音連貫；長稿後段音質可能略降
  - `自動分段（較不易破音）`：長篇腳本以投影片邊界自動切段，各段 PCM 串接並插入 800ms 靜音，解決破音問題
  - 選單只在 `TTS_CHUNKING_ENABLED=true`（server 已開啟分段功能）時顯示；`false` 時整個欄位隱藏，預設不分段
  - 每段字數上限由 `TTS_CHUNK_CHARS`（預設 800）控制，切段失敗時最多自動重試 2 次

### 歌曲音訊生成
- 使用 Google Lyria 3 AI 作曲模型
- 輸入歌詞（含段落標記），輸出完整歌曲
- 輸出 `music.mp3`
- 也支援上傳外部歌曲音訊（目前維持 `mp3`，20MB 以內）
- 若想在外部先生成再回來上傳，可使用 [Producer.ai](https://www.producer.ai/invite/XH4T5Q)

### 影片匯出（MP4）

- 在 Step 4 / Step 7 完成後，可將簡報 + 音訊合成為 MP4 影片
- 採用 FFmpeg xfade 轉場（`fade` 淡入淡出），與 PPTX 視覺效果一致
- PPTX 與 MP4 共用同一套 `resolveEffectiveTransitionSec()` 計算轉場時長，確保兩者時間語意完全一致：timings 代表「新頁完全可見的時間點」，在 PPTX 與 MP4 均成立
- **幀數與 cue 一致**：MP4 的影片幀數 = PPTX 投影片張數 = 使用者標記的換頁 cue 數（`buildOrderedImagesFromTimings()` 確保 images 與 timings 長度相同）；生成 PPTX 後會立即同步 `timings` state，確保使用者刻意捨棄部分投影片時（如 12 頁 PDF 只標 11 個換頁點），MP4 與 PPTX 均只輸出 11 頁，不會多出 PDF 多餘的末頁
- 解析度固定 1080p（1920×1080），H.264 / AAC 編碼，支援直接上傳 YouTube
- 若已有 SRT，可在匯出前勾選「燒入字幕」，將字幕永久嵌入畫面；未勾選時仍可另外下載 `.srt`
- 生成後快取於瀏覽器記憶體，同一 session 內可多次下載而不重跑 FFmpeg
- 點選「重新生成」會立即清除快取並重新合成；「重試」在錯誤後也會直接重跑，無需再次手動點擊
- 以下情況會自動清除影片快取（需重新匯出）：重新生成或上傳音訊、重跑 Step 4 / Step 7 PPTX 對齊、套用偏移至轉場、載入歷史紀錄或開新專案
- 容器版 Docker image 會一併安裝 `fontconfig` 與 `Noto CJK`，確保繁中字卡拉 OK/字幕燒入時不會缺字
- 需要 `VIDEO_EXPORT_ENABLED=true` 及容器內安裝 FFmpeg（Dockerfile 已內建）
- 本地 Windows 開發時需額外設定 `VIDEO_FFMPEG_BIN` 指向 FFmpeg bin 目錄

### PowerPoint 簡報生成（AI 精準對齊轉場）
- 後端採用 **兩階段對齊流程**：先產出/修正 SRT，再根據 `startSrtId` 找出每張投影片第一次進入的字幕位置。
- `Step 4` 與 `Step 7` 皆可拆分為：
  - `4.1 / 7.1`：多模態理解（音訊 + 參考文本），固定使用 Gemini 系列
  - `4.2 / 7.2`：文字對齊（script/lyrics + SRT），可使用 Gemini 或本地 `gemma-4-31B-it`
- **歌曲對齊核心設計**：Phase 1 採「lyrics-as-anchor」策略，歌詞文字是唯一正確來源，音訊只負責定位時間。
- **Podcast 對齊核心設計**：以實際音訊為主、腳本為輔，先修正逐段字幕文字，再對應每張投影片開始的字幕 id。
- **SRT 優先（SRT-first）人工確認流程**：對齊完成後，Step 4 / Step 7 下方會出現兩階段確認面板——先確認 SRT 字幕內容（`SrtReviewPanel`），再透過 `SrtCueEditor` 手動指定每張投影片的換頁起始字幕列（也可略過，使用 AI 自動對齊結果）；確認後才解鎖「生成 PPTX」按鈕。
- **SRT 字幕文字可直接點擊修改**：在 `SrtReviewPanel` 中，每一列字幕文字均可直接點擊進入 `<textarea>` 編輯（時間軸不可調整）；離開面板（blur）時自動儲存至 IndexedDB，同時清除下游 PPTX / MP4 快取以確保下次生成會使用最新文字；已確認的對齊狀態（`srtConfirmed`）刻意保留不重設。MP4 燒入字幕時的來源亦使用最新編輯版本（`podcastSrtForBurn` / `musicSrtForBurn`，已自動剝除 `[slide-N]` 標記以符合 FFmpeg libass 規格）。
- **換頁標記縮圖預覽**：在 `SrtCueEditor` 點擊 slide chip 後，下方會即時顯示對應投影片縮圖（16:9，140×79px），方便確認畫面與字幕對應關係；縮圖延遲渲染（首次點擊才觸發），後續切換不重跑。
- **PPTX / MP4 幀順序跟隨 cue 標記**：PPTX 與 MP4 的幀數均等於 SRT `[slide-N]` 標籤數（cue 數），而非 PDF 頁數；投影片順序依使用者 cue 的 `slideIndex` 重排，支援重複出現或以非 PDF 頁序呈現（`buildOrderedImagesFromTimings()`）。
- 若 AI 配對失敗或不足，系統仍會退回 `lyrics/script weight fallback` 或均分 fallback，避免流程中斷。
- PDF 每頁透過 Canvas 渲染為圖片，注入 XML 轉場效果 `<p:fade/>` 產生淡入特效。
- 第一頁嵌入的音訊物件會額外補寫 `<p:timing>`，讓 PowerPoint 更接近「開場自動播放 + 跨頁持續播放」的行為。
- 最後一頁仍會保留 `advTm`，並在原本時長後額外多等 2 秒再跳向不存在的下一頁，方便後續輸出為影片時保留結尾停留時間。
- **PPTX 轉場補償（`buildTransitionAdjustedTimings()`）**：PPTX 換頁時間以 `resolveEffectiveTransitionSec()` 推算有效轉場時長，並從 `durationSec` 中扣除；原始 timings 保留於 state 與 IndexedDB，調整後的 timings 僅在輸出 PPTX 時使用，確保 SRT offset 重封裝與 MP4 使用的時間語意保持一致。

| 檔案 | 換頁時間計算方式 |
|---|---|
| `podcast.pptx` | 依據對齊後 SRT 與使用者 cue 標記（或 `startSrtId` 自動對齊）推算換頁時間；幀數 = cue 數；音訊嵌入第一頁並補寫 timing XML |
| `music.pptx` | 依據歌詞錨點、對齊後 SRT 與使用者 cue 標記（或 `startSrtId` 自動對齊）推算換頁時間；幀數 = cue 數；音訊嵌入第一頁並補寫 timing XML |

> 目前程式已補寫 PowerPoint timing XML，實務上更接近「第一頁自動播放、跨頁持續播放」。但不同版本的 PowerPoint 相容性仍可能有差異；若播放行為不如預期，保守做法仍是下載後將音訊與簡報同時啟動。

---

## 可下載檔案

| 顯示名稱（按鈕文字） | 說明 | 解鎖時機 |
|---|---|---|
| `script.txt` | Podcast 對話文稿 | 文稿生成後 |
| `lyrics.txt` | 歌曲歌詞 | 歌詞生成後 |
| `podcast.wav` / `podcast.mp3` / `podcast.m4a` | Podcast 音訊 | 音訊生成或上傳後 |
| `music.mp3` | 歌曲音訊 | 音樂生成後 |
| `podcast.srt` | Podcast 字幕 | Podcast 對齊完成後 |
| `music.srt` | 音樂字幕 | 音樂對齊完成後 |
| `podcast.pptx` | Podcast 同步簡報 | Step 4 完成後 |
| `music.pptx` | 音樂同步簡報 | Step 7 完成後 |
| `podcast.mp4` / `podcast.subbed.mp4` | Podcast 影片（1080p，含 fade 轉場）；勾選燒入字幕時檔名加 `.subbed` | Step 4 完成後，需啟用 VIDEO_EXPORT_ENABLED |
| `music.mp4` / `music.subbed.mp4` | 音樂影片（1080p，含 fade 轉場）；勾選燒入字幕時檔名加 `.subbed` | Step 7 完成後，需啟用 VIDEO_EXPORT_ENABLED |

> **實際下載檔名帶時間戳記**：以上顯示名稱僅為按鈕文字。實際下載的檔案會自動帶上 `_HHmmss` 時間標籤（本地時間），例如 `script_181646.txt`、`podcast_181646.pptx`、`podcast_181646.mp4`。Podcast 系列以文稿生成時間為錨點，音樂系列以歌詞生成時間為錨點。同一工作階段多次下載可安全共存，不會互相覆蓋。
>
> **燒字幕版檔名**：勾選「燒入字幕」後匯出的 MP4 會在時間戳記後加 `.subbed` 後綴，例如 `podcast_181646.subbed.mp4`，與未燒字幕版（`podcast_181646.mp4`）並存不衝突；下載總覽的影片按鈕會即時反映目前快取版本的實際檔名。

---

## 操作流程

```
若 AUTH_ENABLED=true：先輸入 invitation code 並完成 Google 登入
  ↓
Step 0  設定 API Key、說話者角色、TTS 聲音、歌曲風格
  ↓
Step 1  上傳 PDF → 確認投影片清單
  ↓
Step 2  生成 Podcast 文稿
  ↓
Step 3  生成或上傳 Podcast 音訊
  ↓
Step 4  AI 聆聽並產生 Podcast 簡報 (精準對齊)
          └─ 確認 SRT 字幕 → 手動標記換頁 cue（可選）→ 生成 PPTX
  ↓
Step 5  生成歌詞
  ↓
Step 6  生成或上傳歌曲音訊（約 30–180 秒）
  ↓
Step 7  AI 聆聽並產生 音樂 簡報 (精準對齊)
          └─ 確認 SRT 字幕 → 手動標記換頁 cue（可選）→ 生成 PPTX
  ↓
下載所有檔案
```

每個步驟完成後才解鎖下一步。可重新生成單一步驟而不影響其他步驟，也可在對齊完成後調整 SRT offset 再重新封裝 PPTX。套用偏移後，PPTX、SRT 時間戳與 MP4 影片快取會同步更新，offset slider 歸零，確保三者保持一致。

---

## 設定說明（Step 0）

### Gemini API Key
- 填入自己的 Gemini API Key（BYOK — Bring Your Own Key）
- Key 僅儲存於瀏覽器 `sessionStorage`，關閉分頁後自動清除
- 不會傳送至伺服器儲存
- 可從 [Google AI Studio API Keys](https://aistudio.google.com/api-keys) 取得

### 語音表達模式

| 模式 | 說明 |
|---|---|
| 雙人對談 | Speaker 1 + Speaker 2 交替（原預設） |
| 單人講解 | 僅 Speaker 1，教學風格 |
| 單人說故事 | 僅 Speaker 1，敘事風格 |

切換模式會清除已產生的文稿、歌詞與對齊資料；已下載的音訊與簡報不受影響。

### Podcast 文稿變數

| 欄位 | 預設值 | 說明 |
|---|---|---|
| Speaker 1 描述 | 男生為節目主持人 | 三種模式均使用 |
| Speaker 2 描述 | 女生為高師大的老師 Mary 老師（具教學經驗，說明清楚） | 僅雙人模式顯示 |
| 對話形式 | 採自然流暢的對話形式，具有節目感與互動感 | |
| 語氣風格 | 語氣親切、易懂，適合一般聽眾 | |

欄位留空時自動套用預設值。

### 內容語言

| 選項 | 說明 |
|---|---|
| 繁體中文（zh-TW）| 預設值 |
| English | 英文內容生成 |
| 日本語 | 日文內容生成 |
| 한국어 | 韓文內容生成 |

**作用範圍**：同時影響 Podcast 文稿（Step 2）、歌詞（Step 5）、及對應的 TTS / 音樂生成（Step 3 / 6）。  
**語言強制約束**：四種語言皆有明確的語言指定 block，主體內容不得改用其他語言作為主要輸出；歌詞 prompt 另有獨立且更嚴格的語言 block，`zh-TW / ja / ko` 明確禁止英文成為主體歌詞，`en` 則要求英文為主體而非反向禁止。  
**結構標記不會隨語言改變**：不論選哪種語言，`風格:` / `投影片 N:` / `Speaker 1:` / `Speaker 2:` / `[Verse N] [Slide N]` 標記均維持固定格式，確保 parser 與後續流程穩定。  
**本地 LLM 注意事項**：非繁中內容建議搭配 Gemini 文字模型使用；本地 `Gemma 4 31B (Custom)` 在非繁中時可能有標記翻譯的風險，UI 會顯示提示。  
**切換語言後**：已生成的文稿與歌詞不會自動清除，若需要對齊新語言請手動重新生成。

### TTS 聲音選擇

| 角色 | 預設 | 可選 | 顯示條件 |
|---|---|---|---|
| Speaker 1 | Puck（Male） | Puck / Charon / Fenrir / Orus | 所有模式 |
| Speaker 2 | Zephyr（Female） | Zephyr / Kore / Leda / Aoede | 僅雙人模式 |

### 模型選擇

- `Step 1 / 4.1 / 7.1`：`gemini-3.1-pro-preview` / `gemini-3-flash-preview` / `gemini-2.5-flash`（預設）
- `Step 2 / 4.2 / 5 / 7.2`：目前以 provider-aware 方式區分模型，預設為 `Gemma 4 31B (Custom)`；同時可選 `Gemma 4 26B (Google)`、`Gemma 4 31B (Google)` 與 Gemini 系列
- `Step 3`：`gemini-2.5-pro-preview-tts` / `gemini-2.5-flash-preview-tts`（預設）
- `Step 6`：`lyria-3-pro-preview`（預設）
- 這些選擇會隨專案紀錄一起存入 IndexedDB，重新載入歷史紀錄時會自動還原

---

## 技術架構

### 分層設計

| 層 | 技術 | 職責 |
|---|---|---|
| 前端 | React（Next.js App Router）+ TypeScript | UI、步驟狀態、IndexedDB 讀寫、PPTX 生成、檔案下載 |
| 前端核心套件 | `pdfjs-dist` | PDF 每頁渲染為圖片（Stage 1 壓縮預處理 + Stage 7 PPTX 頁面圖片） |
| 前端核心套件 | `pptxgenjs` | PPTX 生成與每頁自動換頁計時設定 |
| 後端 | Next.js API Routes | Gemini API Key 安全代理、Google OAuth/session 驗證、Whisper 串接、本地 OpenAI-compatible LLM 串接、時間軸解析 |
| AI 服務 | Google Gemini API + NCHC Whisper API + OpenAI-compatible LLM | 文稿、歌詞、TTS、音樂生成、SRT 對齊、文字比對 |
| 持久化 | 瀏覽器 IndexedDB | 儲存所有生成結果（文字、音訊 Blob、PPTX Blob），auth 啟用時依 Google email 隔離 |

### 使用的 AI 模型

| 流程 | 可選模型 |
|---|---|
| Step 1 / 4.1 / 7.1 | `gemini-3.1-pro-preview` / `gemini-3-flash-preview` / `gemini-2.5-flash`（預設） |
| Step 2 / 4.2 / 5 / 7.2 | `Gemini 3.1 Pro` / `Gemini 3 Flash` / `Gemini 2.5 Flash` / `Gemma 4 26B (Google)` / `Gemma 4 31B (Google)` / `Gemma 4 31B (Custom, 預設)` |
| Step 3 | `gemini-2.5-pro-preview-tts` / `gemini-2.5-flash-preview-tts`（預設） |
| Step 6 | `lyria-3-pro-preview`（預設） |
| Whisper 對齊（若啟用） | `whisper-Breeze-ASR-25`（可由 `NCHC_WHISPER_MODEL` 覆蓋） |

### 儲存策略

- **伺服器端：零儲存** — 容器重啟不影響使用者資料，不需要資料庫
- **`sessionStorage`** — 儲存 API Key，關閉分頁自動清除
- **`localStorage`** — auth 啟用時儲存 session token 與登入 email
- **`IndexedDB`** — 儲存所有生成內容；auth 啟用時會以 `ownerEmail` 隔離歷史紀錄

### BYOK（Bring Your Own Key）架構

```
前端輸入 API Key → 存入 sessionStorage
  ↓
每次 API 呼叫 → Header X-Gemini-Key 帶入 Key
  ↓
Next.js API Route → 讀取 Header Key → 呼叫 Gemini API
  ↓
Gemini 回傳結果 → 前端儲存至 IndexedDB
```

後端不儲存 Key、不連資料庫、不處理業務邏輯，職責僅為安全代理。

### 🔒 資安防護與隱私聲明 (Security & Privacy)

本專案採行嚴格的「無狀態（Stateless）」與「無伺服器金鑰」設計，擁有極高的安全性：
1. **無寫死金鑰（No Hardcoded Keys）**：原始碼中不包含任何 Gemini 或其他 API Key。不論是 Push 上 GitHub 或是將專案設為公開（Public），絕對不會有「連帶洩漏金鑰導致被盜刷」的風險。
2. **BYOK 與 Auth 分離**：Gemini API Key 仍由使用者自行輸入並存於 `sessionStorage`；auth 啟用時，Google OAuth / invitation code / session secret 則由 `.env.local` 或部署環境變數控制。
3. **前端銷毀機制（Client-side Protection）**：使用者的 API Key 僅短暫儲存於瀏覽器當下分頁的 `sessionStorage`，只要關閉該網頁分頁就會立刻銷毀消失。
4. **帳號隔離的本機歷史**：當 `AUTH_ENABLED=true` 時，歷史紀錄會依目前登入的 Google email 隔離；`AUTH_ENABLED=false` 時則回到共用本機歷史模式。

---

## 使用限制

- PDF 投影片數量：**3-25 張**
- 不提供 Podcast 與音樂的混音
- 歷史紀錄僅限當前瀏覽器可見（存於 IndexedDB）；若 auth 啟用則依 Google 帳號隔離

---

## 前置需求

- Node.js 20+（與 Dockerfile 一致）
- Google Gemini API Key
  - 至少需開通 `gemini-3-flash-preview`、`gemini-2.5-flash-preview-tts`、`lyria-3-pro-preview`
  - 若要切換其他下拉模型，還需具備 `gemini-3.1-pro-preview`、`gemini-2.5-flash`、`gemini-2.5-pro-preview-tts` 的存取權限
- 若要啟用登入：Google OAuth Client ID、invitation code、session secret
- 若要啟用影片匯出（本地開發）：[FFmpeg](https://ffmpeg.org/download.html) — 安裝後設定 `VIDEO_FFMPEG_BIN` 指向 bin 目錄（Docker / Cloud Run 已內建，不需設定）

---

## 安裝與啟動

```bash
# 安裝相依套件
npm install

# 啟動開發伺服器（package.json 已內建 --webpack）
npm run dev
```

開啟瀏覽器至 `http://localhost:3000`，於 Step 0 填入 Gemini API Key 即可開始使用。

若 `AUTH_ENABLED=true`，則會先進入登入頁，完成 invitation code + Google 登入後才會進入工作台。

常用 `.env.local` 設定：

```env
AUTH_ENABLED=false
NEXT_PUBLIC_AUTH_ENABLED=false
INVITATION_CODE=change-me
SESSION_SECRET=replace-with-a-long-random-secret
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com

NCHC_WHISPER_API_KEY=...
NCHC_WHISPER_MODEL=whisper-Breeze-ASR-25
NCHC_WHISPER_URL=https://portal.genai.nchc.org.tw/api/v1/audio/transcriptions
LOCAL_LLM_BASE_URL=http://127.0.0.1:8000/v1/chat/completions
LOCAL_LLM_API_KEY=replace-with-your-local-llm-key
LOCAL_LLM_MODEL=gemma-4-31B-it
LOCAL_LLM_LABEL=Gemma 4 31B (Custom)

# Video Export (需要 FFmpeg)
VIDEO_EXPORT_ENABLED=true
NEXT_PUBLIC_VIDEO_EXPORT_ENABLED=true
VIDEO_MAX_CONCURRENT=0
VIDEO_FFMPEG_PRESET=veryfast
# Windows 本地開發：指向 ffmpeg.exe 所在目錄（Linux/Docker 留空即可）
VIDEO_FFMPEG_BIN=C:\path\to\ffmpeg\bin

# TTS 分段生成（解決長篇破音）
TTS_CHUNKING_ENABLED=false
```

說明：
- `AUTH_ENABLED=false` 時，`INVITATION_CODE` / `SESSION_SECRET` / Google Client ID 可先不填
- 若不使用 Whisper 對齊，可先不填 `NCHC_WHISPER_*`；系統會退回 Gemini-only 或 fallback 流程
- `LOCAL_LLM_*` 為選配，供 `Step 2 / 4.2 / 5 / 7.2` 這類純文字推理步驟改接本地 OpenAI-compatible 模型
- 只有在 `LOCAL_LLM_BASE_URL` 與 `LOCAL_LLM_API_KEY` 都存在時，設定區第二組模型下拉才會顯示本地模型選項
- 若 `LOCAL_LLM_BASE_URL` 已直接填到 `/chat/completions`，程式會直接使用；若只填到 `/v1`，則會自動補上 `/chat/completions`
- `LOCAL_LLM_MODEL` 為本地模型實際送出的模型名稱，若有設定，會優先覆蓋前端同組下拉選單的本地模型值
- `LOCAL_LLM_LABEL` 為 UI 顯示名稱；例如你可以把 `gemma-4-31B-it` 顯示為 `Gemma 4 31B (Custom)`
- `VIDEO_EXPORT_ENABLED=true` 啟用影片匯出功能；需同時設定 `NEXT_PUBLIC_VIDEO_EXPORT_ENABLED=true`（build-time）
- `VIDEO_FFMPEG_BIN` 僅 **Windows 本地開發** 時需要，填入 ffmpeg.exe 所在目錄；Linux / Docker / Cloud Run 留空，程式直接呼叫系統 `ffmpeg`
- `TTS_CHUNKING_ENABLED=true` 啟用 TTS 分段生成功能；`false`（預設）時 Step 3 不顯示 TTS 生成模式選單，一律不分段。使用者的最終選擇（分段 / 不分段）在 Step 3 UI 控制，env flag 僅作為 server 能力開關。Cloud Run 部署時透過 `_TTS_CHUNKING_ENABLED` substitution 傳入
- `NEXT_PUBLIC_*` 變數會在 build 時注入前端，Docker / Cloud Run 部署時請在建置階段就提供正確值

---

## 部署與發布

本專案支援多種部署方式，你可以依照需求選擇適合的環境。

### 方式 1：使用 Docker 容器化

適用於本地測試或自家伺服器：

```bash
# 1. 建立 Docker 映像檔
# 若要啟用 auth，請把 NEXT_PUBLIC_* 改成對應正式值
docker build \
  --build-arg NEXT_PUBLIC_AUTH_ENABLED=false \
  --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com \
  -t deckcast-app .

# 2. 啟動容器（將系統 port 3000 指向容器）
docker run -p 3000:3000 --env-file .env.local -d deckcast-app
```
啟動後，於瀏覽器前往 `http://localhost:3000` 即可使用。

注意：
- 若有啟用 auth，建議不要把正式的 `.env.local` 直接 bake 進 image；較安全的做法是以 `--env-file` 或個別 `-e` 參數在 runtime 注入
- `NEXT_PUBLIC_AUTH_ENABLED` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` 屬於前端 build-time 變數，若 Docker image 是在另一個環境建置，建置時就要提供正確值
- `NCHC_WHISPER_*` 與 `LOCAL_LLM_*` 都屬於 server-side runtime 變數；若要啟用 Whisper 或本地 OpenAI-compatible LLM，請透過 `.env.local`、`--env-file` 或個別 `-e` 參數注入容器

### 方式 2：使用 Docker Compose (推薦於私有伺服器部署)

專案內已附帶設定好的 `docker-compose.yml`，包含：
- `Dockerfile` build args：會把 `NEXT_PUBLIC_AUTH_ENABLED` 與 `NEXT_PUBLIC_GOOGLE_CLIENT_ID` 注入建置階段
- `env_file: .env.local`：會把 server-side 的 auth、Whisper 與 `LOCAL_LLM_*` 設定注入容器 runtime
- Port 3000 綁定、healthcheck 與自動重新啟動設定

這是最乾淨、最不怕主機套件衝突的啟動方式。

```bash
# 1. 一鍵建置並在背景啟動所有服務（包含自動重啟機制）
docker compose --env-file .env.local up -d --build

# 2. 檢視運行狀態與 log 日誌
docker compose logs -f

# 3. 停止與關閉服務
docker compose down
```

啟動後，於瀏覽器前往 `http://localhost:3000` 即可使用。

使用前請先把 [`.env.example`](./.env.example) 複製成 `.env.local`，再填入實際值。
由於 `docker compose` 的 build args 需要在建置階段就可見，建議固定使用 `docker compose --env-file .env.local ...` 這種寫法。

#### 更新已運行的服務（切換 branch / 拉新版）

不需要停機重建，直接切換 branch 後重 build 即可。瀏覽器 IndexedDB 的歷史紀錄不受影響。

```bash
# 1. 切換到新 branch（或 git pull 拉新版）
git fetch origin
git checkout <new-branch-name>

# 2. 重新 build 並熱替換容器（服務中斷約 1–2 分鐘）
docker compose --env-file .env.local up -d --build
```

**常見問題：git fetch 出現 `insufficient permission for adding an object to repository database .git/objects`**

伺服器上若之前曾以 `sudo` 或 root 執行過 docker / git 操作，`.git/objects` 擁有者可能被改為 root。修復方式：

```bash
sudo chown -R $(whoami):$(whoami) .git
git fetch origin
```

#### 啟用 SSL（自有憑證 + 自訂網域）

若需要 HTTPS，專案已內建 nginx 反向代理設定。架構如下：

```
Internet :443/:80 → nginx（SSL termination）→ deckcast:3000（內部）
```

**步驟 1：放入 SSL 憑證**

將憑證檔案放到專案根目錄下的 `ssl/` 資料夾：

```
ssl/
  cert.pem   ← 憑證（含 chain，即 fullchain.pem）
  key.pem    ← 私鑰
```

**步驟 2：啟動（與一般方式相同）**

```bash
docker compose --env-file .env.local up -d --build
```

nginx 會自動接管 80 / 443，HTTP 請求會自動 redirect 到 HTTPS。

**nginx 設定重點（`nginx/default.conf`）：**
- `proxy_buffering off` — 確保 LLM streaming / SSE 不被暫存卡住
- `client_max_body_size 60M` — 配合 PDF 與音訊上傳需求
- `proxy_read_timeout 600s` — 配合長時間 AI 處理

### 方式 3：雲端部署 (Google Cloud Run)

建議在部署前先確保本地端 `npm run build` 不會產生 TypeScript 語法錯誤。

正式部署建議直接使用 repo 內建的 `cloudbuild.yaml`。它現在已經會：
- 在 Docker build 時帶入 `NEXT_PUBLIC_AUTH_ENABLED`、`NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- 在 Cloud Run deploy 時帶入 auth、Whisper 與本地 OpenAI-compatible LLM 所需的 runtime env vars

若你要部署較高承載版本，也可以改用 [cloudbuild_500.yaml](./cloudbuild_500.yaml)。這份設定會額外指定：
- `CPU=2`、`--cpu-boost`
- `Memory=4Gi`
- `Concurrency=4`
- `Min instances=1`
- `Max instances=60`

#### 部署步驟

```bash
# 1. 登入 Google Cloud
gcloud auth login

# 2. 設定目標專案
gcloud config set project gen-lang-client-0039151647

# 3. 提交 Cloud Build 部署
#    ⚠️ 重要：在 PowerShell 中 --substitutions 值必須用雙引號包住，
#    否則 PowerShell 會把逗號當陣列分隔符，導致環境變數設定錯誤。
gcloud builds submit --config cloudbuild.yaml "--substitutions=_IMAGE_TAG=manual-202604120830,_AUTH_ENABLED=true,_NEXT_PUBLIC_AUTH_ENABLED=true,_INVITATION_CODE=1234,_SESSION_SECRET=1234,_GOOGLE_CLIENT_ID=57229660377-v7jstv378vq150lpn8bt32afsubde7ki.apps.googleusercontent.com,_NEXT_PUBLIC_GOOGLE_CLIENT_ID=57229660377-v7jstv378vq150lpn8bt32afsubde7ki.apps.googleusercontent.com,_NCHC_WHISPER_API_KEY=1234,_NCHC_WHISPER_MODEL=whisper-Breeze-ASR-25,_NCHC_WHISPER_URL=https://portal.genai.nchc.org.tw/api/v1/audio/transcriptions,_LOCAL_LLM_BASE_URL=https://portal.genai.nchc.org.tw/api/v1/chat/completions,_LOCAL_LLM_API_KEY=1234,_LOCAL_LLM_MODEL=gemma-4-31B-it,_LOCAL_LLM_LABEL=Gemma-4,_VIDEO_EXPORT_ENABLED=true,_NEXT_PUBLIC_VIDEO_EXPORT_ENABLED=true,_MEMORY=2Gi"
```

若你要部署高承載版本，改用：

```bash
gcloud builds submit --config cloudbuild_500.yaml "--substitutions=_IMAGE_TAG=manual-202604120830,_AUTH_ENABLED=true,_NEXT_PUBLIC_AUTH_ENABLED=true,_INVITATION_CODE=1234,_SESSION_SECRET=1234,_GOOGLE_CLIENT_ID=57229660377-v7jstv378vq150lpn8bt32afsubde7ki.apps.googleusercontent.com,_NEXT_PUBLIC_GOOGLE_CLIENT_ID=57229660377-v7jstv378vq150lpn8bt32afsubde7ki.apps.googleusercontent.com,_NCHC_WHISPER_API_KEY=1234,_NCHC_WHISPER_MODEL=whisper-Breeze-ASR-25,_NCHC_WHISPER_URL=https://portal.genai.nchc.org.tw/api/v1/audio/transcriptions,_LOCAL_LLM_BASE_URL=https://portal.genai.nchc.org.tw/api/v1/chat/completions,_LOCAL_LLM_API_KEY=1234,_LOCAL_LLM_MODEL=gemma-4-31B-it,_LOCAL_LLM_LABEL=Gemma-4-31B-Custom"
```

#### 補充說明

- `_IMAGE_TAG` 用於版本追蹤，建議格式 `manual-YYYYMMDDHHMI`（例如 `manual-202604120830`）；同一 tag 的 image 會同時打上 `:latest` 與版本 tag，方便日後回溯或回滾
- `GOOGLE_CLIENT_ID`、`INVITATION_CODE`、`SESSION_SECRET` 是 auth 啟用時必需的 server-side 參數
- `NCHC_WHISPER_*` 會影響 Whisper 對齊能力；未設定時仍可退回非 Whisper 路徑，但精準度可能下降
- `LOCAL_LLM_*` 為選配；只有在你要讓 `Step 2 / 4.2 / 5 / 7.2` 走本地 OpenAI-compatible 模型時才需要提供
- `LOCAL_LLM_LABEL` 可自訂 Cloud Run 畫面顯示名稱；例如 `Gemma 4`、`Qwen 32B`
- `NEXT_PUBLIC_AUTH_ENABLED`、`NEXT_PUBLIC_GOOGLE_CLIENT_ID` 屬於前端 build-time 變數；請透過 Cloud Build substitutions 或其他建置環境變數在 build 時注入
- `cloudbuild.yaml` 內建的是可直接使用的預設值；正式部署前務必以 substitutions 覆蓋 `change-me` 類型參數
- `LOCAL_LLM_BASE_URL` 若填到 `/v1`，程式會自動補成 `/chat/completions`；若你已直接提供完整的 `/chat/completions` 端點，也可以直接使用
- `VIDEO_EXPORT_ENABLED=true` 啟用影片匯出；`cloudbuild.yaml` 預設為 `false`，需手動帶入 substitution
- `_MEMORY` 在 `cloudbuild.yaml` 預設為 `1Gi`；啟用影片匯出時建議加到 `2Gi` 以上，否則 FFmpeg 可能 OOM
- 若部署後 Cloud Run 顯示「需要驗證」而非「公開存取」，可執行 `gcloud run services add-iam-policy-binding <service-name> --region asia-east1 --member="allUsers" --role="roles/run.invoker"` 開放匿名呼叫
- **PowerShell 注意事項**：`--substitutions` 參數值中包含逗號，PowerShell 會將其解讀為陣列分隔符。務必使用雙引號 `"..."` 將整段參數包住

---

## 完成條件（Definition of Done）

使用者可以：

- 在需要時先完成登入驗證
- 填寫設定或使用預設值
- 上傳 PDF 並確認投影片內容
- 生成 Podcast 對話文稿並預覽
- 生成或上傳 Podcast 音訊並播放
- 生成 Podcast 簡報並下載 SRT / PPTX
- 生成歌詞並預覽
- 生成或上傳歌曲音訊並播放
- 生成音樂簡報並下載 SRT / PPTX
- （選用）匯出 Podcast / 音樂 MP4 影片並下載，同一 session 內快取不重跑
- 重新整理頁面後歷史紀錄仍存在，且 auth 啟用時會依 Google 帳號隔離
