# Podcast & Music Generator - 開發 / 重構 TODOLIST

這份清單提煉自 `spec.md`，作為專案開發與架構建置的核心前置任務與功能清單。打勾項代表目前已實裝完成的系統歷程（包含最新的 v03 架構升級）。

## 1. 專案初始化與前置環境設定
- [x] 初始化 Next.js (App Router, Tailwind, TypeScript)
- [x] 安裝核心依賴套件：`@google/genai`, `pdfjs-dist`, `pptxgenjs`, `idb`, `jszip`
- [x] 複製 `pdf.worker.min.mjs` 到 `public/` 目錄
- [x] 設定 `next.config.ts` (處理 webpack 對 Node.js 模組的 fallback 與 alias)
- [x] 建立 `empty-module.js` 以繞過瀏覽器前端不支援的 fs/http 等 Node API

## 2. 核心底層架構與資安建置
- [x] **BYOK 安全機制**：保護使用者 API Key，實作 XOR + Base64 編解碼 (`encodeApiKey`, `decodeApiKey`)
- [x] **API fetch 封裝**：讀取前端 `sessionStorage` 的 Key 並隱藏於 `X-Gemini-Key` Header 傳送
- [x] **IndexedDB 持久化存儲**：設定 `lib/db.ts`，瀏覽器端存放生成紀錄與大型 Blob 檔案，達成後端零儲存
- [x] **登入 / Session 門哨**：新增 invitation code + Google OAuth 雙重驗證、HMAC session token、登入 API (`/api/auth/google`, `/api/auth/login`) 與可由 `.env.local` 控制的 `AUTH_ENABLED` 開關
- [x] **帳號隔離歷史紀錄**：`AUTH_ENABLED=true` 時以 Google email 作為 `ownerEmail` 隔離 IndexedDB 歷史；`AUTH_ENABLED=false` 時維持共用本機歷史
- [x] **資料層 owner 保護**：`updateRecord` / `deleteRecord` 加入 owner 驗證，並將 email 正規化為 lowercase，避免跨帳號修改或刪除紀錄

## 3. 基礎模型與提示詞 (Prompts) 架構
- [x] 定義所有支援模型：指定 `gemini-3-flash-preview`, `lyria-3-pro-preview`, 與多聲道 TTS 模型
- [x] 將 Step 0 設定區重構為四組模型下拉：`Step 1 / 4.1 / 7.1` 使用多模態 Gemini、`Step 2 / 4.2 / 5 / 7.2` 可切 Gemini / `gemma-4-31B-it`、`Step 3` 為 TTS、`Step 6` 為 Lyria
- [x] 製作「Podcast 雙人對話腳本」提示詞 (支援注入 Speaker 1、Speaker 2、風格、語氣自訂)
- [x] 製作「雙層控制結構 (Dual-Layer Prompt)」歌詞提示詞，改為機器解析優先格式：`[段落名稱] [Slide N]`、禁止 AI 自行輸出時間軸、禁止用 `()` / `{}` 寫不可唱提示
- [x] 新增 `normalizeTimings` 時間校正引擎，建立遇到 API 解析錯誤時的防呆數學退路
- [x] **歌曲對齊 Prompt 契約同步**：重寫 `FIND_TRANSITIONS_PROMPT`，明確改為「投影片錨點摘要 JSON + SRT JSON -> startSrtId」，移除舊的 `vocalStartSec` 契約
- [x] **Podcast 對齊 Prompt 完整化**：補齊 `GENERATE_PODCAST_SRT`、`REFINE_PODCAST_SRT_TEXT_PROMPT`、`FIND_PODCAST_TRANSITIONS_PROMPT`，和音樂鏈維持相同的兩階段對齊思路

## 4. API 路由與雲端 AI 介接實作
- [x] `POST /api/parse-pdf`: 提供 PDF 圖片交由 Gemini 快速 OCR 視覺解析文字
- [x] `POST /api/generate-script`: 依據 PDF 簡報內容生成 Podcast 逐字稿
- [x] `POST /api/generate-lyrics`: 依據投影片段落生成分秒精準的 AI 歌詞
- [x] `POST /api/generate-podcast`: 介接 Gemini Multi-speaker TTS，順利將單一文字雙人扮演回傳 `audio/wav`
- [x] `POST /api/generate-music`: 呼叫 Lyria 3 作曲，實作了「無序 parts 防呆迴圈安全解析」抓取 `audio/mp3`
- [x] `POST /api/align-podcast` & `/api/align-music`: 實作 2-step AI 對齊流程；Phase 1 產出/修正 SRT，Phase 2 以 `startSrtId` 對齊投影片，再由程式換算精準轉場時間
- [x] **Whisper + Gemini 混合 ASR**：新增 `lib/whisper.ts` 與 `lib/srt.ts`，將 Whisper 逐字稿、Gemini SRT、文字修正與 fallback 整理成共用模組
- [x] **音訊 MIME 一致性**：`align-podcast` / `align-music` 接收前端傳入的 `audioMimeType`，不再寫死 `audio/wav`
- [x] **本地 OpenAI-compatible LLM Provider**：新增 `lib/llm.ts`，讓 `Step 2 / 4.2 / 5 / 7.2` 可切到 `gemma-4-31B-it`
- [x] **文字模型改為 provider-aware 結構**：`TEXT_MODEL_OPTIONS` 目前改為 `id + provider + model + label`，可同時區分 `Gemma 4 31B (Google)` 與 `Gemma 4 31B (Custom)`

## 5. 前端流程 UI 與簡報 (PPTX) 渲染
- [x] 實作嚴謹的順序解鎖流程流：PDF -> Podcast 文稿 -> Podcast 音訊/上傳 -> Podcast 簡報 -> 歌詞 -> 音樂音訊/上傳 -> 音樂簡報
- [x] 前端串接：捨棄前端猜測秒數，改由後端回傳 `timings` 與 `startSrtId` 對齊結果統一推算時間軸
- [x] `lib/generatePptx.ts`: 利用瀏覽器 Canvas 把唯讀的 PDF 高解析度渲染轉換為單張圖片
- [x] 自動在 PPTX 第一頁左上角注入 `.wav` 或 `.mp3` 多媒體音訊物件
- [x] 動態替換 PPTX 底層 XML，對全投影片注入 `<p:fade/>` 淡化轉場；最後一頁不再設為 0 秒，而是使用原本應有時長後再額外多等 2 秒收尾
- [x] **Podcast / Music 上傳雙模式**：Step 3 / Step 6 支援「API 生成」與「外部音檔上傳」兩條路徑，並補齊格式限制、檔案大小限制與提示文案
- [x] **SRT 偏移重封裝**：新增 SRT offset 調整與重新封裝 PPTX 功能，讓對齊微調不必整條流程重跑
- [x] **登入頁設計**：新增獨立 `LoginPage`，當 `AUTH_ENABLED=true` 時先進登入頁，再進入主工作台
- [x] **Podcast / Music 下載命名修正**：下載檔名改為與實際 Blob MIME 一致，避免 WAV 被誤命名為 MP3
- [x] **模型設定簡化**：前端 state 收斂為 `multimodalModel` 與 `textModel` 兩個核心模型值，再映射到 Step 4 / Step 7 的 phase 參數
- [x] **本地模型顯示名稱環境化**：新增 `LOCAL_LLM_LABEL`，讓 Step 0 第二組模型下拉可依部署環境顯示 `Gemma 4`、`Qwen 32B` 等自訂名稱
- [x] **PPTX 音訊 timing 補寫**：`generatePptx.ts` 會在第一頁媒體物件上補寫 `<p:timing>` 與 `numSld`，讓 PowerPoint 更接近自動播放與跨頁持續播放

## 6. 後期測試與邊界除錯
- [x] 清理舊程式碼：刪除不需要的手動 SRT 拼裝邏輯 (`extractSlideTexts`, `formatSrtTime`)
- [x] 移除舊有 `30-second` 短歌選項，並將 Step 6 統一收斂為 `lyria-3-pro-preview`
- [x] 確認並修改全站針對簡報頁數的文字提醒與邊界阻擋邏輯，目前統一為「3-15頁」
- [x] 全專案通過 TypeScript 嚴格型別檢查 (`tsc --noEmit`) 無錯誤
- [x] **音樂對齊 Prompt 精準化**：重寫 `GENERATE_MUSIC_SRT`，明確分工「lyrics = 唯一正確文字來源，audio = 只用來定位時間」，根除 AI 自行辨識歌詞導致文字失真的問題；強化 `FIND_TRANSITIONS_PROMPT`，補充前 6–8 字定錨關鍵字、前奏/間奏邊界處理、無標記時輸出空陣列等規則；`align-music/route.ts` 加入 Phase 1 獨立 try/catch 與 Phase 2 fallback 防呆機制
- [x] **歌曲錨點摘要重建**：`buildSlideAnchorSummary()` 改為逐行依 `[Slide N]` 聚合內容，正確支援新格式 `[Verse 1] [Slide 2]`
- [x] **Podcast / Music 對齊鏈一致化**：兩條鏈都改為 `Whisper/Gemini -> SRT -> startSrtId -> timings -> diagnostics`，並通過 lint / build 驗證
- [x] **Cloud Run 高承載部署檔**：新增 `cloudbuild_500.yaml`，以 `deckcast500` 作為獨立高承載服務設定，方便活動或多人同時使用

## 7. 2026-04-06 補充完成項目
- [x] 導入 `google-auth-library`，完成後端 Google ID token 驗證
- [x] 將 auth、Google Client ID、invitation code、session secret 全部納入 `.env.local` 管理
- [x] 補強 `apiFetch` 未授權分類：區分 `auth` 失效與 `API Key` 失效，前端可分別提示
- [x] 修正 Podcast 生成 route 的音訊回傳型別，確保 Next.js build 通過
- [x] 將前端選擇的模型值一路傳入各 API route，讓 Step 1 / 2 / 4 / 5 / 7、Step 3、Step 6 不再寫死模型
- [x] 將 `README.md` / `SPEC.md` / `TODOLIST.md` 同步更新為 `3-15頁` PDF 上限與可切換模型規格
- [x] 修正 `stripMarkdown()`，保留 fenced code block 內文、只移除 ``` 包裝，避免本地模型輸出正文被誤清空

## 8. 2026-04-10 plan_D 完成項目（VideoExportBlock + Session Cache + xfade + 修正）

### 8.1 影片匯出 UI 重設計
- [x] **新建 `components/VideoExportBlock.tsx`**：獨立卡片區塊，取代嵌入式 `VideoExportButton`；props 包含 `cachedBlob` / `onCached` 管理 session 快取
- [x] **刪除 `components/VideoExportButton.tsx`**：已被 VideoExportBlock 完全取代
- [x] **修改 `app/page.tsx`**：新增 `podcastVideoBlob` / `musicVideoBlob` session 快取 state；Step 4 / Step 7 下方各掛載獨立 VideoExportBlock；Download Panel 改為直接下載快取 blob，不重觸發 FFmpeg
- [x] **快取失效時機**：重跑 Step 4 / Step 7 PPTX 生成、載入歷史紀錄、新專案，均自動清除對應 video blob

### 8.2 xfade 轉場實作
- [x] **新增 `buildXfadeArgs()`**（`lib/videoExport.ts`）：使用 FFmpeg `xfade` filter_complex 實作 fade 淡入淡出，與 PPTX `<p:fade/>` 視覺行為一致
- [x] **重構 `buildConcatArgs()`**：原有 concat demuxer 邏輯獨立為函式，`transition=none` 或單張投影片時使用
- [x] **xfade 時序公式**：`fadeDur[i] = clamp(0.1, 0.8, durationSec - 0.2)`；`cumOffset` 累積計算（FFmpeg offset 為絕對時間）

### 8.3 Bug 修正 — xfade 影片提早結束
- [x] **根本原因**：xfade 每個轉場消耗 `fadeDur` 秒輸出時間軸，導致影片比音訊短 `sum(fadeDurs)` 秒；加上 `-shortest` 使影片在音訊結束前截斷
- [x] **修正方案**：預先計算 `totalFadeDuration = sum(fadeDurs)`；最後一張投影片 `-t` 延長 `totalFadeDuration + 2.0s`（+2s 對應 PPTX 最後一頁 +2000ms）；移除 `-shortest`

### 8.4 Podcast 結尾問題 Prompt 工程
- [x] **新增最後一張投影片結尾規則**（`lib/prompts.ts` `PODCAST_PROMPT_TEMPLATE`）：主持人拋出開放式問題 + 另一位給一句語境化回應，讓問題自然收尾
- [x] **修正字面範例污染**：移除 prompt 中的字面台詞範例（每次 LLM 直接複製），改用抽象行為描述，確保每次生成不同語境的收尾

### 8.5 自動重試機制
- [x] **503 自動重試**（`VideoExportBlock.tsx`）：遇到伺服器忙碌（503）時，最多自動重試 5 次，每次等待 10 秒；UI 顯示琥珀色「⏳ 伺服器忙碌，10 秒後自動重試（第 N/5 次）…」，與一般載入的藍色視覺明確區分

### 8.6 部署設定補充
- [x] **新增多規格 Cloud Run 部署檔**：`cloudbuild_202.yaml`（2Gi/2CPU）、`cloudbuild_404.yaml`（4Gi/4CPU）、`cloudbuild_408.yaml`（8Gi/4CPU），三份均預設啟用 VIDEO_EXPORT_ENABLED
- [x] **補充 `VIDEO_FFMPEG_BIN`**（`.env.example`）：本地 Windows 開發用，Docker / Cloud Run 留空
- [x] **新增 `instrumentation.ts`**：伺服器啟動時自動清理 `/tmp/video-export` 殘留目錄

## 9. 2026-04-11 plan_E 完成項目（資料一致性、VideoExportBlock API、Prompt 補齊）

### 9.1 Phase 1 — 資料一致性修正（`app/page.tsx`）
- [x] **`resetPodcastDerivedState()` 補齊 video blob 清除**：加入 `setPodcastVideoBlob(null)`，確保重新生成或上傳音訊時影片快取一併失效
- [x] **`resetPodcastDerivedState()` 補齊 IndexedDB 清除**：補入 `updateRecord` 呼叫，清除 `podcastPptxBlob / podcastSrt / podcastDiagnostics / podcastTimings`，與 music 路徑對稱
- [x] **`resetMusicDerivedState()` 補齊三項清除**：補入 `setMusicTimings(null)` / `setMusicSrtOffset(0)` / `setMusicVideoBlob(null)`，並在 IndexedDB 更新加入 `musicTimings: undefined`
- [x] **`handleRepackPodcastPptx()` 重構**：套用偏移後同步更新 `podcastTimings`（以 newTimings 取代原始值）、將 offset 烘入 `podcastSrt`（使用 `adjustSrtTimes`）、清零 `podcastSrtOffset`、清除 `podcastVideoBlob`；IndexedDB 同步寫入 `podcastTimings` 與 `podcastSrt`
- [x] **`handleRepackMusicPptx()` 重構**：與 Podcast 路徑對稱，修正內容相同

### 9.2 Phase 2 — VideoExportBlock API 修正
- [x] **新增 `onClearCache` prop**（`VideoExportBlockProps`）：`() => void`，讓元件能通知 parent 清除 cachedBlob
- [x] **「重新生成」按鈕改為單步驟**：點擊後依序呼叫 `onClearCache()` → `setForceRegen(true)` → `handleGenerate()`，不再需要使用者再次手動點擊下載按鈕
- [x] **「重試」按鈕直接重跑**：改為呼叫 `handleGenerate()`，`handleGenerate()` 內部會自行 reset status，不需在外部先 reset
- [x] **`app/page.tsx` 兩個 `<VideoExportBlock>` 補入 `onClearCache` prop**：分別傳入 `() => setPodcastVideoBlob(null)` 與 `() => setMusicVideoBlob(null)`

### 9.3 Phase 2 補充 — `loadRecord()` SRT offset 歸零
- [x] **`loadRecord()` 補齊 offset 重置**：加入 `setPodcastSrtOffset(0); setMusicSrtOffset(0);`，避免前一個專案的 offset 值在切換歷史紀錄時滲入新載入的紀錄

### 9.4 Phase 3 — Prompt 補齊與 API body 限制修正
- [x] **補入 Podcast 收尾規則**（`lib/prompts.ts` `PODCAST_PROMPT_TEMPLATE`）：補回 `plan_D_done.md` 記載但未寫入程式的最終版本；要求最後一頁由主持人拋出開放式問題，另一位給一句語境化收尾，不可使用固定套話
- [x] **export-video API body 上限調整**（`app/api/export-video/route.ts`）：從 50MB 提升至 150MB，對應 50MB 音訊 base64 後 ≈67MB + 圖片的實際需求
- [x] **修正 Content-Length bypass**：原本若 header 缺失則 `parseInt('0') = 0`，完全繞過大小限制；改為 header 存在才做 pre-flight 檢查，並額外新增 `rawBody` 實際 byte 計數作為真正防線

## 10. 2026-04-11 plan_F 完成項目（三種語音表達模式）

### 10.1 F1 — 模式切換骨架（`lib/types.ts`、`app/page.tsx`）
- [x] **新增 `NarrationMode` 型別**（`lib/types.ts`）：`'duo' | 'solo_explainer' | 'solo_story'`
- [x] **`GenerationRecord` 新增 `narrationMode?: NarrationMode`**：隨專案存入 IndexedDB
- [x] **`narrationMode` state**（`app/page.tsx`）：`useState<NarrationMode>('duo')`
- [x] **`isDuo` 與 `lyricsSource` derived values**：`isDuo = narrationMode === 'duo'`；`lyricsSource = isDuo ? script : slides`
- [x] **三按鈕切換列 UI**（Step 0）：雙人對談 / 單人講解 / 單人說故事
- [x] **模式感知欄位顯示**：Speaker 2 描述與 Voice 2 選擇在單人模式下隱藏
- [x] **模式感知動態標題**：Step 2 / 3 標題與 loading 訊息依模式切換

### 10.2 F2 — Prompt 模板重構（`lib/prompts.ts`、`app/api/generate-script/route.ts`、`app/api/generate-lyrics/route.ts`）
- [x] **廢棄 `PODCAST_PROMPT_TEMPLATE` / `buildPodcastPrompt`**，改為三套獨立模板
- [x] **`DUO_PODCAST_PROMPT_TEMPLATE`**：雙人，移除強制開放式問題規則，改為自然收尾
- [x] **`SOLO_EXPLAINER_PROMPT_TEMPLATE`**：單人 Speaker 1，教學風格
- [x] **`SOLO_STORY_PROMPT_TEMPLATE`**：單人 Speaker 1，敘事風格
- [x] **`buildNarrationPrompt()` dispatcher**：依 mode 分發模板
- [x] **`generate-script` route 接收 `narrationMode`**，改用 `buildNarrationPrompt`
- [x] **`generate-lyrics` route 新增 `lyricsSource` 欄位**：solo 模式傳入 `slides`，duo 傳入 `script`

### 10.3 F3 — TTS 修正（`app/api/generate-podcast/route.ts`）
- [x] **`generate-podcast` route 接收 `narrationMode`**
- [x] **修正 Gemini API 限制**：`multiSpeakerVoiceConfig` 要求剛好 2 個 config，原先送 1 個造成 400；solo 模式改用單聲道 `voiceConfig`，完全不走 `multiSpeakerVoiceConfig` 路徑
- [x] **新增 `extractSoloScript()`**：solo 模式專用；提取 `風格:` 作為朗讀指令、剝除 `Speaker 1:` 前綴、過濾投影片標題行，組成 TTS 友善 prompt 格式
- [x] **`extractDialogue()` 維持 duo 專用**：`/^Speaker\s+\d+/i` 正規式邏輯不變
- [x] **WAV 回應改用 `Buffer`**：移除中間 `Blob` 包裝層，直接 `Buffer.from(wavData.buffer, ...)` 傳入 `NextResponse`，解決大型音訊 `net::ERR_FAILED 200 (OK)` 問題

### 10.4 補充修正 1 — 模式切換後游離狀態清除（`app/page.tsx`）
- [x] **`handleNarrationModeChange()` 清除下游 state**：`script`、`lyrics`、SRT、timings、diagnostics、step 2–7 狀態
- [x] **保留 blob**：`podcastBlob` / `musicBlob` / `podcastPptxBlob` / `musicPptxBlob` 不清除，已產出資產仍可下載
- [x] **`saveRecord` / `handleGenerateScript` 傳遞 `narrationMode`**

### 10.5 補充修正 2 — narrationMode IndexedDB 即時持久化（`app/page.tsx`）
- [x] **`handleNarrationModeChange()` 立即呼叫 `updateRecord()`**：切換當下同步寫入 IndexedDB，不依賴 useEffect 延遲
- [x] **`loadRecord()` 直接 `setNarrationMode()`**：不通過 handler，避免觸發不必要的 DB 寫入循環

## 11. 2026-04-12 plan_I / plan_I01 完成項目（TTS 分段生成與品質修正）

### 11.1 TTS 分段生成核心（`app/api/generate-podcast/route.ts`、`lib/constants.ts`）
- [x] **`TTS_CHUNKING_ENABLED` feature flag**：server-side `process.env.TTS_CHUNKING_ENABLED === 'true'` 控制，`false` 維持現況不分段；duo / solo 均套用
- [x] **`TTS_CHUNK_CHARS = 800`**：每段台詞字數上限（≈ 3–4 分鐘），以投影片邊界為優先切點（2026-04-14 由 1000 調降為 800，實測音質校正值）
- [x] **`CHUNK_GAP_MS = 800`**：chunk 間插入固定靜音（ms），作為常數方便調整
- [x] **`splitScriptIntoChunks()`**：兩層切分邏輯；Layer 1 以 `投影片 N：` 邊界切分並累積字數，Layer 2 在單頁超長時以 Speaker 行細切，單行超長則拋出 `CHUNK_TOO_LONG` 400 錯誤
- [x] **`createSilence(durationMs, sampleRate): Uint8Array`**：生成全零 Int16 LE PCM 靜音段
- [x] **`trimLeadingSilence()` / `trimTrailingSilence()`**：DataView + `pcm.byteOffset` 正確讀取 Int16，裁切段首冷啟動靜音與段尾死靜音
- [x] **`concatPcmChunks()`**：串接所有 Uint8Array PCM 段
- [x] **整條 PCM 鏈使用 `Uint8Array`**：規避 TypeScript 5.x `Buffer<ArrayBufferLike>` 不可賦值給 `BodyInit` 的編譯錯誤；`makeWavResponse()` 以 `wavData.buffer as ArrayBuffer` 傳入 `NextResponse`
- [x] **multi-chunk 迴圈**：每段 push PCM 後（非末段）插入靜音；前段 trim 尾部、後段 trim 頭部，使接縫更自然
- [x] **`callTtsApi()` 自動重試**：500 系列最多重試 2 次、間隔 2 秒；4xx / auth 錯誤直接拋出

### 11.2 前端估時與警示（`app/page.tsx`、`lib/ttsEstimate.ts`）
- [x] **新增 `lib/ttsEstimate.ts`**：`countDialogueChars()`、`estimateTtsDuration()`、`estimateChunkCount()` 三支工具函式，供 UI 估算使用
- [x] **Step 3 估時公式**：`estSec = speechSec + (ttsChunkingEnabled ? (chunkCount-1) × 0.8 : 0)`；`estMin = Math.ceil(estSec × 0.8 / 60)`（實測約為估算值 80%）
- [x] **`ttsChunkingEnabled` runtime state**：從 `/api/runtime-config` 讀取，供 UI 判斷是否顯示 chunk 停頓警示

### 11.3 投影片時間軸修正（`lib/timing.ts`）
- [x] **`calcPodcastTimings()` 比例修正**：改用 `slideTexts.slice(0, slideCount).reduce(...)` 計算 `totalChars`，避免腳本 `投影片` 標記數多於 PDF 頁數時分母稀釋，導致所有投影片換頁提前

### 11.4 solo 逐字稿空白行修正（`app/api/generate-podcast/route.ts`）
- [x] **`extractSoloScript()` 加 `.filter(Boolean)`**：`Speaker 1:` 後無內容的行經 `.map()` 後產生空字串，加 filter 後不再送入 TTS，消除不預期停頓

### 11.5 設定檔與部署（`.env.example`、`cloudbuild.yaml`、`docker-compose.yml`）
- [x] **`.env.example` 新增 `TTS_CHUNKING_ENABLED=false`**：附說明，方便新部署者了解用途
- [x] **`cloudbuild.yaml` / `cloudbuild_202/404/408.yaml` 新增 `TTS_CHUNKING_ENABLED`**：以 `_TTS_CHUNKING_ENABLED` substitution 傳入；預設 `false`，需手動帶入啟用
- [x] **`docker-compose.yml` 新增 `TTS_CHUNKING_ENABLED`**：`${TTS_CHUNKING_ENABLED:-false}` 從 `.env.local` 讀取

## 12. 2026-04-12 plan_J 完成項目（contentLanguage 多語支援）

### 12.1 型別與常數（J1）
- [x] **新增 `ContentLanguage` type**（`lib/types.ts`）：`'zh-TW' | 'en' | 'ja' | 'ko'`
- [x] **`GenerationRecord` 新增 `contentLanguage?: ContentLanguage`**：隨專案存入 IndexedDB
- [x] **`DEFAULT_CONTENT_LANGUAGE = 'zh-TW'`**（`lib/constants.ts`）：預設繁體中文，確保舊紀錄向下相容
- [x] **`CONTENT_LANGUAGE_OPTIONS`**（`lib/constants.ts`）：四語選單陣列，供 UI 渲染用
- [x] **`CONTENT_LANGUAGE_PROMPT_LABEL`**（`lib/constants.ts`）：語言代碼對應英文標示 Map，傳給模型 prompt 時使用（英文標示最穩定）

### 12.2 前端 UI（J2）
- [x] **`contentLanguage` state**（`app/page.tsx`）：`useState<ContentLanguage>(DEFAULT_CONTENT_LANGUAGE)`
- [x] **Step 2 設定區新增「內容語言」選單**：排列在「語氣風格」欄位之後、模型選單之前；使用現有 `selectCls` 樣式
- [x] **非 zh-TW 警示提示**：選非繁中時顯示 `非繁體中文建議搭配 Gemini 文字模型使用` 琥珀色小字
- [x] **說明文字**：選單下方顯示 `影響 Podcast 文稿、語音、歌詞與歌曲生成`

### 12.3 Prompt 語言化（J3）
- [x] **`buildLanguageBlock()`**（`lib/prompts.ts`）：`zh-TW` 回傳空字串（行為不變）；其他語言產生【語言指定】區塊，含固定結構標記保護規則與正反例，防止本地 LLM 翻譯 `風格:` / `投影片 N:` / `Speaker 1:` / `Speaker 2:` 標記
- [x] **三個 narration template 加入 `language` 參數**：`DUO_PODCAST_PROMPT_TEMPLATE` / `SOLO_EXPLAINER_PROMPT_TEMPLATE` / `SOLO_STORY_PROMPT_TEMPLATE` 均於 prompt 開頭插入 `buildLanguageBlock(language)`
- [x] **`buildNarrationPrompt()` 接收 `language?`**：可選，預設 `DEFAULT_CONTENT_LANGUAGE`
- [x] **`buildLyricsPrompt()` 第三個可選參數 `language?`**：`zh-TW` 行為不變；其他語言在 prompt 末尾追加【歌詞語言指定】區塊，包含 K-POP/J-POP 多語混唱例外規則
- [x] **`generate-script` route 讀取 `contentLanguage`**，傳入 `buildNarrationPrompt`（`lib/types` 已型別化）
- [x] **`generate-lyrics` route 讀取 `contentLanguage`**，傳入 `buildLyricsPrompt`

### 12.4 Record 流（J4）
- [x] **`saveRecord` 帶入 `contentLanguage`**（Step 1 PDF 解析完成時）
- [x] **`handleGenerateScript` updateRecord 帶入 `contentLanguage`**（Step 2）
- [x] **`handleGeneratePodcast` updateRecord 帶入 `contentLanguage`**（Step 3 API 生成）
- [x] **`handlePodcastUpload` updateRecord 帶入 `contentLanguage`**（Step 3 上傳）
- [x] **`handleGeneratePodcastPptx` updateRecord 帶入 `contentLanguage`**（Step 4）
- [x] **`handleGenerateLyrics` updateRecord 帶入 `contentLanguage`**（Step 5）
- [x] **`handleGenerateMusic` updateRecord 帶入 `contentLanguage`**（Step 6 API 生成）
- [x] **`handleMusicUpload` updateRecord 帶入 `contentLanguage`**（Step 6 上傳）
- [x] **`handleGenerateMusicPptx` updateRecord 帶入 `contentLanguage`**（Step 7）
- [x] **`loadRecord()` 回填 `contentLanguage`**：`rec.contentLanguage ?? DEFAULT_CONTENT_LANGUAGE`（舊紀錄無此欄位時平滑 fallback）
- [x] **`handleNewProject()` 重置 `contentLanguage`**：新專案時恢復 `DEFAULT_CONTENT_LANGUAGE`
- [x] **`handleRepackPodcastPptx` updateRecord 帶入 `contentLanguage`**（SRT 偏移重封裝 Step 4）
- [x] **`handleRepackMusicPptx` updateRecord 帶入 `contentLanguage`**（SRT 偏移重封裝 Step 7）
- [x] **`handleNarrationModeChange` updateRecord 帶入 `contentLanguage`**（模式切換即時持久化）
- [x] **所有 updateRecord 呼叫已完整覆蓋**：Steps 2~7 + 兩個 upload handler + 兩個 repack + narrationMode 切換，任意路徑執行後 IndexedDB 均持有最新 contentLanguage，舊 record backfill 徹底完整

### 12.5 Audio Route logging（J5）
- [x] **`generate-podcast` route 接收 `contentLanguage`**：新增 `console.log` 記錄語言語境，供除錯使用
- [x] **`generate-music` route 接收 `contentLanguage`**：同上，方便未來加 Lyria wrapper prompt
- [x] **`app/page.tsx` Step 3 / Step 6 API 呼叫帶入 `contentLanguage`**

### 12.7 Whisper 多語對齊（plan_J1）
- [x] **`lib/whisper.ts` 新增 `mapContentLanguageToWhisperLanguage()`**：`zh-TW→zh / en→en / ja→ja / ko→ko`；未知值回傳 `undefined`（auto-detect）
- [x] **`lib/whisper.ts` 移除隱藏 fallback**：`form.append('language', params.language || 'zh')` 改為 `if (params.language) { form.append(...) }`，避免 route 傳 undefined 時仍偷偷回退中文
- [x] **`align-podcast/route.ts` 接收 `contentLanguage`**：import `mapContentLanguageToWhisperLanguage`，解構 `contentLanguage`，映射為 `whisperLanguage` 後傳入 `transcribeAudioWithWhisper()`
- [x] **`align-music/route.ts` 接收 `contentLanguage`**：同上
- [x] **`app/page.tsx` Step 4 / Step 7 align request 補傳 `contentLanguage`**：確保對齊鏈完整，不再只有生成鏈有效

### 12.8 loadRecord() 殘留狀態修正
- [x] **所有 blob / step state 補 else 清空**：`podcastBlob` / `podcastPptxBlob` / `musicBlob` / `musicPptxBlob` / `pdfFile` 以及 Step 1~7 states，有值回填、無值清空，載入不完整 record 時不殘留前一專案狀態
- [x] **speaker / voice / dialogueStyle / tone 補 else 回預設**：欄位缺失時恢復 DEFAULT_* 值

### 12.9 程式碼品質清理
- [x] **`VideoExportBlock.tsx`**：移除未使用的 `isLoading` 變數
- [x] **`lib/prompts.ts`**：移除未用的 imports（`DEFAULT_SPEAKER1` / `DEFAULT_DIALOGUE_STYLE` / `DEFAULT_TONE`）；移除廢棄的 `LYRICS_PROMPT_TIMED_OLD` / `LYRICS_PROMPT_TIMED_OLD2`
- [x] **`lib/srt.ts`**：`catch (e)` → `catch {}` 清掉 unused binding
- [x] **`handleNewProject()` 加 code comment**：明確說明「保留偏好設定、清除專案內容」為設計決策

### 12.10 README 資料修正
- [x] **TTS 聲音預設修正**：Speaker 1 = Puck（Male）、Speaker 2 = Zephyr（Female）（原本寫反且性別錯誤）
- [x] **預設多模態模型修正**：Step 1/4.1/7.1 預設改為 `gemini-2.5-flash`（兩處：功能說明區與模型表格）

### 12.11 ESLint 說明
- [x] **專案程式碼 warnings 全清**：`VideoExportBlock` / `lib/prompts` / `lib/srt` unused warnings 已消除
- [ ] **`public/pdf.worker.min.mjs` lint 警告**：屬第三方 minified 檔，不影響 build / 功能；config-protection hook 保護 eslint.config.mjs，警告保留為已知已評估狀態

### 12.12 未做項目（明確延後）
- [ ] **J6 Step 4 / Step 7 align prompt 語言化**：`GENERATE_PODCAST_SRT` / `REFINE_PODCAST_SRT_TEXT_PROMPT` / `GENERATE_MUSIC_SRT` / `REFINE_MUSIC_SRT_TEXT_PROMPT` 改為可參數化函式；需同步修改 `align-podcast/route.ts`、`align-music/route.ts` 與前端 API 呼叫，範圍較大，本期延後
- [ ] **語言切換後提醒 banner**：本期不實作，降低 page.tsx 複雜度

## 13. 2026-04-12 部署與維運強化

### 13.1 cloudbuild 版本 tag 支援
- [x] **`cloudbuild.yaml` 加入 `_IMAGE_TAG`**：build / push / deploy 同時打 `:latest` 與 `:${_IMAGE_TAG}`，預設 `manual`，可由 CLI 覆蓋為 `manual-YYYYMMDDHHMI`
- [x] **`cloudbuild_500.yaml` 同步加入 `_IMAGE_TAG`**：同上；`images:` 清單補上版本 tag

### 13.2 Cloud Run 資源明確化（`cloudbuild.yaml`）
- [x] **新增 `--cpu=1`、`--concurrency=10`、`--min-instances=0`、`--max-instances=10`**：取代預設值，Node.js 最小可用配置
- [x] **記憶體從 `512Mi` 調整為 `1Gi`**：Node.js + LLM 串流安全最低值
- [x] **`cloudbuild_500.yaml` 對應調整**：CPU=2 / Memory=4Gi / Concurrency=4 / Min=1；新增 `--cpu-boost`；服務名稱統一為 `deckcast`

### 13.3 nginx SSL 反向代理（自架伺服器）
- [x] **新增 `nginx/default.conf`**：HTTP → HTTPS redirect；`proxy_buffering off`（LLM streaming）；`client_max_body_size 60M`；`proxy_read_timeout 600s`
- [x] **`docker-compose.yml` 加入 nginx service**：port 80 / 443；掛載 `./nginx/default.conf` 與 `./ssl`；`depends_on: deckcast`
- [x] **deckcast service 改為 `expose`**：port 3000 不再對外暴露，僅 nginx 內部存取
- [x] **README 補充 SSL 啟用說明**：`ssl/cert.pem` + `ssl/key.pem` 放置位置與啟動指令

### 13.4 FFmpeg CPU 執行緒限制（`lib/videoExport.ts`）
- [x] **新增 `getFFmpegThreads()`**：預設 `min(2, cpuCount)`；`VIDEO_FFMPEG_THREADS` env var 可覆蓋，`=0` 不限制
- [x] **`buildConcatArgs()` / `buildXfadeArgs()` 加入 `-threads N` 與 `-filter_threads N`**：後者確保 xfade filter graph 也受限（global `-threads` 管不到 filter graph）
- [x] **`.env.example` 補充 `VIDEO_FFMPEG_THREADS`**：含說明與預設行為

### 13.5 使用量記錄（`lib/usageLogger.ts`）
- [x] **新增 `lib/usageLogger.ts`**：`logUsage(email, action)` — stdout（永遠）+ 檔案（`LOG_FILE_PATH` 設定時）
- [x] **`getEmailFromRequest(req)`**：安全取得 session email，auth 關閉時回傳 `null`
- [x] **接入全部 8 個 API route**：`parse-pdf` / `generate-script` / `generate-lyrics` / `generate-podcast` / `generate-music` / `align-podcast` / `align-music` / `export-video`
- [x] **`docker-compose.yml` 掛載 `./logs:/app/logs`**，並設 `LOG_FILE_PATH=/app/logs/usage.jsonl`
- [x] **`.env.example` 補充 `LOG_FILE_PATH`**：Docker 填路徑；Cloud Run 留空走 stdout → Cloud Logging

## 14. 2026-04-14 plan_K 完成項目（PPTX/MP4 時序統一）

### 14.1 共用轉場計算函式（`lib/timing.ts`）
- [x] **新增 `resolveEffectiveTransitionSec(durationSec)`**：`clamp(0.1, 0.75, durationSec * 0.3)`，同時不超過 `durationSec - 0.1`；PPTX 與 MP4 共用此函式，確保轉場時長計算語意一致
- [x] **`buildTransitionAdjustedTimings()` 改用 `resolveEffectiveTransitionSec()`**：PPTX 輸出時的換頁時間扣除量與 MP4 使用相同基準；短頁不再因 `max(durationSec - 0.75, 0.5)` 硬保底而拉長超過原本語意 `endSec`
- [x] **原始 timings 保留**：state 與 IndexedDB 儲存未調整的原始 timings；`buildTransitionAdjustedTimings()` 僅在 PPTX 輸出時呼叫，不影響 SRT offset 重封裝與 MP4 的時間計算

### 14.2 MP4 xfade offset 公式修正（`lib/videoExport.ts`）
- [x] **xfade offset 改為直接公式**：`offset = timings[i].endSec - fadeDur`（取代舊版累積 cumOffset），消除舊版在負 offset 頁面後段誤差累積導致影片錯位的問題
- [x] **每張投影片 input `-t` 加入 carry-in**：`-t` = 自身 durationSec + 後續所有轉場的 fadeDur 之和（最後一張再加 2.0s）；確保 xfade 每個轉場都有足夠素材，不會提早截斷後段影像
- [x] **更新 `lib/videoExport.ts` 舊版注解**：對齊實際程式碼，移除殘留的 cumOffset 公式描述，避免後續讀者誤解

## 15. 2026-04-14 plan_L 完成項目（下載命名時間標籤）

### 15.1 型別擴充（`lib/types.ts`）
- [x] **`GenerationRecord` 新增 `scriptGeneratedAt?: number`**：記錄文稿生成時間戳（毫秒 epoch），作為 Podcast 系列下載命名的錨點
- [x] **`GenerationRecord` 新增 `lyricsGeneratedAt?: number`**：記錄歌詞生成時間戳，作為音樂系列下載命名的錨點

### 15.2 命名工具函式（`app/page.tsx`）
- [x] **新增 `formatTimeTag(ts: number): string`**：timestamp 轉 `HHmmss` 本地時間字串
- [x] **新增 `buildTaggedName(base, tag, ext): string`**：有 tag 時回傳 `base_tag.ext`，無 tag 時回傳 `base.ext`
- [x] **新增 `getPodcastTag(scriptGeneratedAt?, createdAt?): string | null`**：優先用 `scriptGeneratedAt`，fallback `createdAt`，均無則 `null`
- [x] **新增 `getMusicTag(lyricsGeneratedAt?, createdAt?): string | null`**：優先用 `lyricsGeneratedAt`，fallback `createdAt`，均無則 `null`

### 15.3 state 管理（`app/page.tsx`）
- [x] **新增 `scriptGeneratedAt` / `lyricsGeneratedAt` state**：`useState<number | null>(null)`
- [x] **`handleGenerateScript()` 記錄時間戳**：`const now = Date.now(); setScriptGeneratedAt(now)`，同步存入 IndexedDB（`scriptGeneratedAt: now`）
- [x] **`handleGenerateLyrics()` 記錄時間戳**：同上，`lyricsGeneratedAt: now`
- [x] **`loadRecord()` 回填時間戳**：`setScriptGeneratedAt(rec.scriptGeneratedAt ?? null); setLyricsGeneratedAt(rec.lyricsGeneratedAt ?? null)`
- [x] **`handleNewProject()` 清除時間戳**：`setScriptGeneratedAt(null); setLyricsGeneratedAt(null)`
- [x] **`handleNarrationModeChange()` 清除時間戳**：`setScriptGeneratedAt(null); setLyricsGeneratedAt(null)`，確保模式切換後不殘留舊標籤

### 15.4 下載點更新（`app/page.tsx`）
- [x] **Podcast 系列（6 個下載點）**：script.txt / podcast 音訊 / podcast.pptx / podcast.srt / podcast.mp4（VideoExportBlock）/ Download Panel 對應按鈕，全部改用 `buildTaggedName(..., getPodcastTag(scriptGeneratedAt, record?.createdAt), ...)`
- [x] **音樂系列（6 個下載點）**：lyrics.txt / music.mp3 / music.pptx / music.srt / music.mp4（VideoExportBlock）/ Download Panel 對應按鈕，全部改用 `buildTaggedName(..., getMusicTag(lyricsGeneratedAt, record?.createdAt), ...)`
- [x] **History Drawer（8 個下載點）**：Podcast / 音樂各 4 個按鈕，改用 `rec.scriptGeneratedAt` / `rec.lyricsGeneratedAt`（fallback `rec.createdAt`）
- [x] **VideoExportBlock 加入 `displayName` prop**：`displayName="podcast.mp4"` / `"music.mp4"`（短名稱顯示），`filename` 仍傳帶時間標籤的完整名稱（實際下載用）

### 15.5 `VideoExportBlock` 元件更新（`components/VideoExportBlock.tsx`）
- [x] **新增 `displayName?: string` prop**：按鈕文字改用 `displayName ?? filename`，UI 顯示名稱與下載檔名完全解耦
- [x] **`filename` 與 `triggerDownload` 調用不變**：`filename` 仍作為實際下載名稱，快取與下載邏輯完全相容

## 16. 2026-04-14 plan_O 完成項目（內容語言強制約束強化）

### 16.1 `buildLanguageBlock()` 強化（`lib/prompts.ts`）
- [x] **移除 `zh-TW` 空字串特例**：原本 `if (language === 'zh-TW') return ''` 導致繁中腳本缺少語言指定，現改為四種語言均輸出完整語言 block
- [x] **加入主體語言禁止換語約束**：block 內新增「主體內容不得改用其他語言作為主要輸出；可保留極少量不可避免的專有名詞原文」，升級約束強度
- [x] **三種腳本模式自動受益**：`DUO_PODCAST_PROMPT_TEMPLATE` / `SOLO_EXPLAINER_PROMPT_TEMPLATE` / `SOLO_STORY_PROMPT_TEMPLATE` 均已呼叫 `buildLanguageBlock()`，Step 1 修正後三者同步生效，不需個別修改

### 16.2 `buildLyricsLanguageBlock()` 新增（`lib/prompts.ts`）
- [x] **新增獨立歌詞語言 block helper**（私有 function，不 export）：歌詞規則比腳本更嚴格，拆出獨立 helper 避免影響腳本 prompt
- [x] **刪除「K-POP / J-POP 可保留少量混語」寬鬆句**：改為「外語不可佔主體」，減少模型自由漂向英文的空間
- [x] **`zh-TW / ja / ko` 分支**：明確加入「不可讓英文成為主體歌詞」與 `Do not use English as the primary language for the sung lyrics.`
- [x] **`en` 分支**：只要求英文為主體，不加「禁止英文」句，避免英文模式自相矛盾

### 16.3 `buildLyricsPrompt()` 修正（`lib/prompts.ts`）
- [x] **移除 `zh-TW` 提前 return**：原本 `if (lang === 'zh-TW') return base` 跳過語言 block，現改為一律附加 `buildLyricsLanguageBlock(lang)`
- [x] **移除舊版內嵌 langBlock 字串**：含「可少量混語」的舊版字串一併刪除，改為呼叫新 helper
- [x] **四種語言策略一致**：全部走 `base + buildLyricsLanguageBlock(lang)`，不再有任何語言走特例路徑
