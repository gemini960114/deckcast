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

## 17. 2026-04-14 plan_N 完成項目（TTS 生成模式使用者選項）

### 17.1 型別擴充（`lib/types.ts`）
- [x] **新增 `TtsGenerationMode` type**：`'single' | 'chunked'`，代表使用者選擇的 TTS 生成策略

### 17.2 前端狀態與 UI（`app/page.tsx`）
- [x] **新增 `ttsGenerationMode` state**：`useState<TtsGenerationMode>('single')`，預設不分段
- [x] **Step 3 新增 TTS 生成模式下拉選單**：條件 `podcastInputMode === 'api' && ttsChunkingEnabled`；包含「不分段（音色較一致）」與「自動分段（較不易破音）」兩個選項；附輔助說明小字
- [x] **`ttsChunkingEnabled=false` 時整個欄位隱藏**：不顯示殘缺的單選下拉，UX 更乾淨
- [x] **Step 3 警示文案改由 `ttsGenerationMode` 驅動**：長稿（`>= TTS_LONG_SEC`）與中稿（`>= TTS_WARN_SEC`）提示均依使用者選擇動態更新，取代原本固定依 `ttsChunkingEnabled` 判斷的版本
- [x] **`handleGeneratePodcast()` payload 加入 `ttsGenerationMode`**：呼叫 `/api/generate-podcast` 時一併帶入使用者選擇

### 17.3 後端修正（`app/api/generate-podcast/route.ts`）
- [x] **request body 解構加入 `ttsGenerationMode`**：預設 `'single'`，向下相容舊呼叫
- [x] **分段決策改由 `ttsGenerationMode` 主導**：`chunkingEnabled = ttsGenerationMode === 'chunked' && serverAllowsChunking`
- [x] **`serverAllowsChunking`（env flag）降為後端防呆**：正常情況前端已隱藏選單，env flag 只防手改 request 或未來非 UI caller

### 17.4 未做（v1 明確延後）
- [ ] generation record 儲存 `ttsGenerationMode`（載入歷史紀錄時還原模式選擇）
- [ ] loading 文案依模式更新
- [ ] 升級為雙選卡片 UI

## 18. 2026-04-17 plan_D 完成項目（生成後可手動編輯腳本）

### 18.1 State 新增（`app/page.tsx`）
- [x] **`isEditingScript` state**：`useState(false)`，控制 Step 2 是否進入腳本編輯模式
- [x] **`scriptDraft` state**：`useState('')`，編輯期間的暫存草稿，不影響 live `script`

### 18.2 Handler 新增（`app/page.tsx`）
- [x] **`handleStartScriptEdit()`**：將 `script` 複製至 `scriptDraft`，設 `isEditingScript = true`
- [x] **`handleCancelScriptEdit()`**：清空 `scriptDraft`，設 `isEditingScript = false`，不修改正式腳本
- [x] **`handleSaveScriptEdit()`**：將 `scriptDraft` 寫回 `script`，更新 `scriptGeneratedAt` 為當下時間，清除所有依賴腳本的下游產物，並同步寫入 IndexedDB
  - 一律清除：Podcast 音訊（`podcastBlob`）、PPTX、SRT、timings、diagnostics、video（呼叫 `resetPodcastDerivedState()`）、Step 3 / Step 4 state
  - **所有模式均清除**：lyrics、lyricsGeneratedAt、musicBlob、及整條 music chain（呼叫 `resetMusicDerivedState()`）、Step 5 / 6 / 7 state（plan_A 後所有模式統一行為，solo_* 亦清除）
  - IndexedDB 同步更新（`updateRecord`）

### 18.3 Step 2 UI 改版（`app/page.tsx`）
- [x] **正常模式**：TextBlock 唯讀 + 新增「編輯腳本」ActionBtn
- [x] **編輯模式**：切換為固定高度 `<textarea>`（`min-h-[320px] max-h-[50vh]`，可捲動）+ 警示小字（儲存後清除 Podcast；duo 模式加一行提示清 music）+ 「儲存修改」/ 「取消」按鈕

### 18.4 Step 3~7 鎖定（`app/page.tsx`）
- [x] **編輯期間 Step 3~7 全部 disabled**：所有 StepCard 的 `disabled` 條件加入 `|| isEditingScript`，防止在 draft 與 live script 並存時誤操作後續流程

## 19. 2026-04-18 plan_A 完成項目（歌詞手動後製編修）

### 19.1 State 新增（`app/page.tsx`）
- [x] **`isEditingLyrics` state**：`useState(false)`，控制 Step 5 是否進入歌詞編輯模式
- [x] **`lyricsDraft` state**：`useState('')`，編輯期間的暫存草稿，不持久化

### 19.2 Handler 新增（`app/page.tsx`）
- [x] **`handleStartLyricsEdit()`**：將 `lyrics` 複製至 `lyricsDraft`，設 `isEditingLyrics = true`
- [x] **`handleCancelLyricsEdit()`**：清空 `lyricsDraft`，設 `isEditingLyrics = false`，不修改正式歌詞
- [x] **`handleSaveLyricsEdit()`**：將 `lyricsDraft` 寫回 `lyrics`，更新 `lyricsGeneratedAt` 為當下時間，清除整條 Music 鏈（musicBlob / SRT / timings / PPTX / MP4），同步寫入 IndexedDB

### 19.3 失效鏈清除擴展（`app/page.tsx`）
- [x] **`handleSaveScriptEdit()` 擴展**：所有模式（duo / solo_*）儲存 script 後均清除 lyrics / lyricsGeneratedAt / Music 鏈；移除舊版「solo_* 不清 lyrics」分支，統一所有模式行為

### 19.4 Step 5 UI 改版（`app/page.tsx`）
- [x] **正常模式**：TextBlock 唯讀 + 新增「編輯歌詞」ActionBtn
- [x] **編輯模式**：固定高度 `<textarea>` + 警示小字（儲存後清 Music 鏈）+ 「儲存修改」/「取消」按鈕
- [x] **Step 6 / 7 編輯期間 disabled**：StepCard `disabled` 條件加入 `|| isEditingLyrics`

## 20. 2026-04-18 plan_B 完成項目（cueIndex 架構 + [No Slide] 移除）

### 20.1 新型別（`lib/types.ts`）
- [x] **`LyricVisualTag` 簡化**：移除 `no-slide` union 分支；改為純 `{ kind: 'slide'; slideIndex: number }`，每個段落必須對應 Slide N
- [x] **`LyricSection`**：`{ sectionIndex, sectionLabel, visualTag: LyricVisualTag, rawHeader, lines }`
- [x] **`VisualCueMatch`**：`{ cueIndex, slideIndex, startSrtId, confidence?, matchReason? }`（以 cueIndex 識別段落，非 slideIndex）
- [x] **`VisualCueTiming`**：`{ cueIndex, slideIndex, startSec, endSec, durationSec }`

### 20.2 新函式（`lib/timing.ts`）
- [x] **`parseLyricSections(lyrics: string): LyricSection[]`**：解析 `[SectionLabel] [Slide N]` 格式的 headers；不匹配的行列入前一段落的 `lines`；無法解析時回傳 `[]`
- [x] **`buildVisualCueTimings(sections, matches, srtEntries, totalDuration): VisualCueTiming[]`**：使用 `interpolateStartTimes` 為每個 cue 計算 startSec/endSec；直接從 `section.visualTag.slideIndex` 取得 slideIndex
- [x] **`buildMusicFallbackTimingsByLyricsWeight()` 改用原始歌詞**：接收 `lyrics`（未剝離標記的原始文字）而非 `structuredLyrics`，確保 `parseLyricSections()` 能正確找到段落標題

### 20.3 align-music route 重構（`app/api/align-music/route.ts`）
- [x] **移除 `extractSlideCount()`**：改用 `parseLyricSections(lyrics)` 後以 `Math.max(...sections.map(s => s.visualTag.slideIndex))` 取得 slideCount
- [x] **`buildVisualCueSummary(sections: LyricSection[]): string`**：取代 `buildSlideAnchorSummary()`，輸出 `cueIndex / sectionLabel / slideIndex / 前後文脈行`
- [x] **`parseVisualCueMatchesJSON(raw, sectionCount, srtEntries): VisualCueMatch[]`**：取代 `parseTransitionMatchesJSON()`，驗證 `cueIndex` 在 `1..sectionCount` 範圍，依 cueIndex 排序
- [x] **Fallback 修正（關鍵 bug fix）**：`buildMusicFallbackTimingsByLyricsWeight()` 呼叫改為傳入 `lyrics`（原始歌詞）而非 `structuredLyrics`（標記已剝離），確保 section-based fallback 能找到段落
- [x] **舊版相容 legacyMatches**：從 `visualCueMatches` 推導 `legacyMatches`（每個 slideIndex 第一次出現的 cueIndex），用於生成 PPTX/MP4 時的 `SlideTimings`
- [x] **回傳擴充**：response 新增 `visualCueTimings` 欄位，保留完整段落序列

### 20.4 Phase 2 Prompt 更新（`lib/prompts.ts`）
- [x] **`FIND_TRANSITIONS_PROMPT` cueIndex 契約**：資料 A 的欄位改為 `cueIndex / sectionLabel / slideIndex`（slideIndex 不再 nullable）；輸出格式改為 `cueIndex` 為 key；規則說明不可修改 cueIndex、不可省略任何 cueIndex
- [x] **`LYRICS_PROMPT_TIMED` 移除 [No Slide]**：段落標記規則改為必須輸出 `[Slide N]`；提供 fallback 規則（第一段 → Slide 1，中途不確定 → 延續前一段）；錯誤範例更新，不再包含 `[No Slide]` 選項

### 20.5 前端 state（`app/page.tsx`）
- [x] **`musicVisualCueTimings` state**：`useState<VisualCueTiming[] | null>(null)`
- [x] **Step 7 response 處理**：從 `data.visualCueTimings` 回填 `musicVisualCueTimings`
- [x] **reset / load / newProject 均補齊 `setMusicVisualCueTimings(null)`**

## 21. 2026-04-18 plan_C 完成項目（Step 5 歌詞內容依據選擇器）

### 21.1 型別與 Record（`lib/types.ts`）
- [x] **`GenerationRecord` 新增 `lyricsContentSource?: 'script' | 'slides'`**

### 21.2 前端 State 與 Handler（`app/page.tsx`）
- [x] **`lyricsContentSource` state**：`useState<'script' | 'slides'>('script')`
- [x] **`handleLyricsContentSourceChange(nextSource)`**：
  - 若無現有歌詞且無 Music 鏈：直接更新 state + 寫 DB
  - 否則：inline 重置所有 Music 鏈 state（不呼叫 `resetMusicDerivedState()` 以避免雙重 updateRecord）+ 單次 `updateRecord` 寫 DB
  - 顯示 toast：`'已切換歌詞內容依據，請重新生成歌詞。'`

### 21.3 Step 5 Guard 修正（`app/page.tsx`）
- [x] **StepCard disabled 改為 source-aware**：`(lyricsContentSource === 'slides' ? !slides : !script) || isEditingScript`
- [x] **`handleGenerateLyrics()` guard 改為 source-aware**：`const hasSource = lyricsContentSource === 'slides' ? !!slides : !!script`
- [x] **API 呼叫補傳 `lyricsSource`**：`lyricsSourceText = lyricsContentSource === 'slides' ? slides : script`

### 21.4 Step 5 UI 新增選單
- [x] **「歌詞內容依據」下拉**：`依講稿生成`（預設）/ `依投影片生成`；生成中或編輯期間 disabled
- [x] **說明小字**：「依講稿生成：歌詞貼近敘事與鋪陳；依投影片生成：歌詞聚焦投影片重點」

### 21.5 loadRecord / handleNewProject / handleNarrationModeChange
- [x] **`loadRecord()` 回填 `lyricsContentSource`**：`rec.lyricsContentSource ?? 'script'`
- [x] **`handleNewProject()` 重置**：`setLyricsContentSource('script')`
- [x] **`handleNarrationModeChange()` 重置 `musicVisualCueTimings`**（plan_B state 一致性）

## 23. 2026-04-19 燒入字幕功能（Burn Subtitles）

### 23.1 後端 FFmpeg 字幕燒入（`lib/videoExport.ts`）
- [x] **新增 `escapeSrtPath()`**：路徑反斜線轉正斜線 + 冒號跳脫（`\:`），確保 Windows 路徑相容 FFmpeg filter 語法
- [x] **新增 `SUBTITLE_STYLE` 常數**：`Fontname=Noto Sans CJK TC,BackColour=&HB0000000,BorderStyle=3,Outline=1,Shadow=0,Fontsize=22`（半透明黑底 + CJK 字型）
- [x] **`GenerateVideoParams` 新增 `srtText?` / `burnSubs?`**：`burnSubs=true` 且 `srtText` 存在時觸發字幕燒入流程
- [x] **`generateVideo()` 寫入暫存 SRT 檔**：`workDir/subtitles.srt`，工作目錄清理時一併刪除
- [x] **`buildConcatArgs()` 支援 `srtPath`**：有 srtPath 時在 `-vf` 後方附加 `subtitles=` filter
- [x] **`buildXfadeArgs()` 支援 `srtPath`**：有 srtPath 時以 `[vxf]` 中間節點橋接 subtitle filter，輸出為 `[vout]`；無 srtPath 時行為不變

### 23.2 API Route（`app/api/export-video/route.ts`）
- [x] **`ExportVideoRequest` 新增 `srtText?` / `burnSubs?`**：接收前端燒字幕請求
- [x] **`params.srtText` 條件賦值**：`body.burnSubs ? (body.srtText ?? undefined) : undefined`；僅 `burnSubs=true` 時才傳入
- [x] **`params.burnSubs` 雙重驗證**：`body.burnSubs === true && !!body.srtText`，防止欄位不一致

### 23.3 前端元件（`components/VideoExportBlock.tsx`）
- [x] **新增 `srtText?: string | null` prop**：有值時顯示「燒入字幕」checkbox，消失時自動取消勾選
- [x] **新增 `cachedFilename?: string | null` prop**：快取影片的實際檔名（可能含 `.subbed`）
- [x] **`onCached` 簽名改為 `(blob: Blob, filename: string) => void`**：將實際檔名一路回傳 parent
- [x] **新增 `burnSubs` state + `hasSrt` derived value**：`hasSrt = Boolean(srtText)`
- [x] **`useEffect` 監聽 `hasSrt`**：`hasSrt` 消失時自動 `setBurnSubs(false)`
- [x] **React Hooks 規則修正**：所有 `useState` / `hasSrt` 計算 / `useEffect` 移至 `if (!videoExportEnabled) return null` early return 之前
- [x] **新增 `getExportFilename()` helper**：`burnSubs && hasSrt` 時回傳 `.subbed.mp4`，否則回傳原檔名
- [x] **Checkbox UI**：位於卡片內、按鈕列上方；生成中時 `opacity-40 pointer-events-none`；勾選變更時呼叫 `onClearCache()` 清除快取
- [x] **`renderButton` 快取狀態**：使用 `cachedFilename ?? filename` 下載，顯示正確後綴檔名

### 23.4 前端狀態管理（`app/page.tsx`）
- [x] **新增 `podcastVideoFilename` / `musicVideoFilename` state**：`useState<string | null>(null)`
- [x] **兩個 `VideoExportBlock` 的 `onCached`**：`(blob, nextFilename) => { setXxxVideoBlob(blob); setXxxVideoFilename(nextFilename); }`
- [x] **下載總覽影片按鈕**：`onClick` 使用 `podcastVideoFilename ?? buildTaggedName(...)`；`label` 顯示 `podcastVideoFilename ?? 'podcast.mp4'`（反映燒字幕狀態）
- [x] **兩個 `VideoExportBlock` 傳入 `cachedFilename` / `srtText` props**

### 23.5 Docker（`Dockerfile`）
- [x] **runner stage 新增 `fontconfig font-noto-cjk`**：確保容器內 Noto Sans CJK TC 字型可用，繁中字幕燒入不缺字

## 22. 2026-04-19 plan_D 第二批完成項目（SRT 優先架構 + 換頁標記編輯 + cue 排序輸出）

### 22.1 SRT 優先架構（plan_D SRT-first）

- [x] **`SrtEntry` / `SrtSlideCue` / `SlideCueEvent`** 型別（`lib/types.ts`）：`SrtSlideCue {srtId, slideIndex}`；`SlideCueEvent {srtId, slideIndex, startSec}`——兩階段 cue 資料模型
- [x] **`buildSlideCueEvents()`**（`lib/timing.ts`）：依 `srtId` 將 `SrtSlideCue` 對應 `SrtEntry` 並組出 `SlideCueEvent[]`
- [x] **`buildTimingsFromSlideCueEvents()`**（`lib/timing.ts`）：由 cue events 衍生 `SlideTimings`，N = cue 數 = SRT `[slide-N]` 標籤數
- [x] **`SrtCueEditor`** 元件（`components/SrtCueEditor.tsx`）：Slide chip bar + SRT 列表；點擊 chip 後點選字幕列可指定換頁起始；再次點選同一列移除標記
- [x] **`SrtReviewPanel`** 元件（`components/SrtReviewPanel.tsx`）：SRT 確認 + 換頁標記編輯整合面板；兩段解鎖：先確認 SRT → 再編輯 cue → 才能生成 PPTX
- [x] **`app/page.tsx` 整合**：`podcastSlideCues` / `musicSlideCues` state；`buildPodcastPptxFromConfirmedSrt()` / `buildMusicPptxFromConfirmedSrt()` 函式當 `slideCues.length > 0` 時使用 `buildSlideCueEvents` + `buildTimingsFromSlideCueEvents` 衍生 timings（不使用舊的 `normalizeTimings` state）

### 22.2 換頁標記縮圖預覽（D13）

- [x] **D13-1 — `SrtCueEditor` 新增 `pdfBlob?: Blob | null` prop**：chip bar 與 SRT 列表之間插入縮圖預覽區
- [x] **D13-2 — 延遲渲染縮圖**：使用者第一次點擊 chip 時才觸發 `pdfToJpegBase64(pdfBlob, 0.3)` 渲染（低畫質、節省記憶體）；渲染中顯示 `animate-pulse` 骨架；縮圖快取於 `thumbnails` state，後續切換 chip 不重跑
- [x] **D13-3 — `app/page.tsx` 傳入 `pdfBlob`**：兩個 `<SrtCueEditor>` 均補入 `pdfBlob={pdfFile}`

### 22.3 cue 排序輸出修正（D14）

- [x] **D14-1 — `buildOrderedImagesFromTimings()`**（`lib/generatePptx.ts`，已 export）：依 timings `[i].slideIndex - 1` 從 `allImages` 取出對應頁，確保 PPTX 與 MP4 的幀順序跟隨使用者 cue 標記，而非 PDF 頁序
- [x] **D14-2 — `generatePptx()` 改用 cue 排序**：`pdfToJpegBase64` 取得 `allImages` 後立即呼叫 `buildOrderedImagesFromTimings(allImages, timings)`，PPTX 頁數 = timings 長度 = cue 數
- [x] **D14-3 — `VideoExportBlock.tsx` 改用 cue 排序**：`handleGenerate()` 中引入 `buildOrderedImagesFromTimings`，確保傳至 `/api/export-video` 的 `images.length === timings.length`，修復 `images length (N) must match timings length (M)` 400 錯誤
- [x] **D14-4 — PPTX 幀數與 SRT slide 標籤數一致（關鍵 bug fix）**：`buildPodcastPptxFromConfirmedSrt()` / `buildMusicPptxFromConfirmedSrt()` 當 `slideCues.length > 0` 時一律從 cues 重新計算 timings，不使用 `podcastTimings`/`musicTimings` state（後者為 `normalizeTimings` 輸出，長度 = PDF 頁數）；修正後 PPTX / MP4 幀數恆等於 cue 數

### 22.4 Bug 修正

- [x] **`Array.isArray()` 防呆**（`app/page.tsx`）：`buildPodcastPptxFromConfirmedSrt` / `buildMusicPptxFromConfirmedSrt` / `handleRepackPodcastPptx` / `handleRepackMusicPptx` 對從 IDB 載入的 timings 加 `Array.isArray()` 檢查，修復舊紀錄載入後呼叫 `.map()` 出現 `TypeError: timings.map is not a function`
- [x] **D4-3 — diagnostics 加入 `srtConfirmed`**：兩條對齊 diagnostics 區塊新增「字幕確認：✓ 已確認 / 自動」欄位，方便確認目前是否使用手動確認 SRT
- [x] **PPTX 生成後同步更新 timings state（關鍵 bug fix）**（`app/page.tsx`）：`buildPodcastPptxFromConfirmedSrt()` / `buildMusicPptxFromConfirmedSrt()` 在從 cue events 計算出 timings 後，立即呼叫 `setPodcastTimings(timings)` / `setMusicTimings(timings)` 同步 state；修正前 `VideoExportBlock` 拿到的是舊版 `normalizeTimings` 輸出（長度 = PDF 頁數），導致使用者刻意捨棄最後一張投影片（如只標 11 個換頁點但 PDF 有 12 頁）時，MP4 仍匯入第 12 張圖，與 PPTX 幀數不一致；修正後 `timings.length` 與 `musicSlideCues.length` / `podcastSlideCues.length` 恆等，PPTX 與 MP4 幀數始終相同

### 22.5 單元測試（D12-1）

- [x] **新增 `__tests__/timing.test.ts`**（25 個測試）：覆蓋 `buildSlideCueEvents` / `buildTimingsFromSlideCueEvents` / `buildSlideCuesFromVisualCueMatches` / `buildSlideCuesFromTransitionMatches` / `normalizeTimings`；與現有 `__tests__/srt.test.ts`（7 個）合計 32 個測試全數通過（`npm test` via vitest）

## 24. 2026-04-19 plan_F（Audio Tags 語氣標籤）

### 24.1 型別與 Record（A）
- [x] **`GenerationRecord` 新增 `audioTagsEnabled?: boolean`**（`lib/types.ts`）：隨專案存入 IndexedDB，重載後可還原 checkbox 狀態

### 24.2 白名單常數（B）
- [x] **新增 `ALLOWED_AUDIO_TAGS`**（`lib/constants.ts`）：第一版 12 個白名單 tags：`neutral / enthusiasm / interest / curiosity / positive / tension / slow / fast / short pause / long pause / whispers / laughs`

### 24.3 Prompt 擴充（C）
- [x] **新增 `buildAudioTagsBlock(mode)`**（`lib/prompts.ts`）：依 `duo / solo_explainer / solo_story` 模式產生對應保守程度的 audio tags 規則 block（使用頻率、允許 tags、連續禁止等）
- [x] **`buildNarrationPrompt()` 新增 `audioTagsEnabled?` 參數**：僅在 `audioTagsEnabled === true` 時附加 tags block；未啟用時行為與現況完全一致

### 24.4 generate-script route（D）
- [x] **request body 解構加入 `audioTagsEnabled`**（`app/api/generate-script/route.ts`）：傳給 `buildNarrationPrompt()`；`false` 為隱性預設，不影響舊呼叫

### 24.5 Step 2 UI（E）
- [x] **Step 2 生成區新增 checkbox**（`app/page.tsx`）：`自動加入語氣標籤（Audio Tags）`，位於生成按鈕上方
- [x] **靜態推薦提示**：「會在腳本中插入如 [enthusiasm]、[short pause] 等Audio Tags標籤，」，非阻擋式提示，不依 TTS 模型 gate

### 24.6 前端 request / record 流（F）
- [x] **`audioTagsEnabled` state**（`app/page.tsx`）：預設 `false`
- [x] **`handleAudioTagsEnabledChange()`**：切換時立即呼叫 `updateRecord()`，與 `narrationLengthPreset` 行為一致
- [x] **`handleGenerateScript()` payload** 加入 `audioTagsEnabled`
- [x] **`updateRecord()` after Step 2** 加入 `audioTagsEnabled`
- [x] **`saveRecord()` at Step 1** 加入 `audioTagsEnabled`（確保 PDF 上傳後 reload 即可還原）
- [x] **`loadRecord()` 回填 `audioTagsEnabled`**：`rec.audioTagsEnabled ?? false`
- [x] **`handleNewProject()` 不重置 `audioTagsEnabled`**：設計決策 — 屬於 Step 2 生成偏好，跨專案保留

### 24.7 相容性驗證（G / H）
- [x] **`copyMode="speaker-only"` 相容**（驗證，不改碼）：只過濾非 Speaker 行，行內 `[tag]` 不受影響
- [x] **`extractDialogue()` / `extractSoloScript()` 相容**（驗證，不改碼）：兩函式均不清除行內 `[tag]`，Step 3 TTS 可直接接收帶 tags 腳本

## 25. 2026-04-19 UI 設定遷移 + TTS 估時修正 + align-podcast duration（Plan G）

### 25.1 UI 設定欄位遷移（`app/page.tsx`）
- [x] **歌曲風格 / 歌詞長度**：從 Step 0 設定區遷入 Step 5 歌詞生成區
- [x] **Voice 1 / Voice 2**：從 Step 0 設定區遷入 Step 3 API 生成區（`podcastInputMode === 'api'` 時顯示）
- [x] **表達模式 / Speaker 1 / Speaker 2 / 對話形式 / 語氣風格 / 旁白長度 / 長度補充說明**：從 Step 0 設定區遷入 Step 2 Podcast 文稿生成區
- [x] **內容語言**：保留於 Step 0 設定區，改為獨立 `mb-4` div，不再與其他欄位混排

### 25.2 TTS 估時係數修正（`lib/ttsEstimate.ts`、`lib/constants.ts`）
- [x] **`CHARS_PER_MIN` 調整為 1.5 倍**：`duo: 220→330` / `solo_explainer: 230→345` / `solo_story: 200→300`，與實測語速吻合
- [x] **警示門檻調高**：`TTS_WARN_SEC: 150→200` / `TTS_LONG_SEC: 240→320`，配合新係數不誤報
- [x] **`estMin` 移除 `× 0.8` 校正**：新係數下已不需要額外折扣

### 25.3 預設值調整（`lib/constants.ts`）
- [x] **`DEFAULT_SPEAKER1 = '阿哲'`**（簡化名稱）
- [x] **`DEFAULT_SPEAKER2 = 'Mary 老師'`**（簡化名稱）
- [x] **`DEFAULT_NARRATION_LENGTH_PRESET = 'brief'`**（預設精簡）

### 25.4 Step 3 UI 文案更新（`app/page.tsx`）
- [x] **提示文字改為「建議至」**，移至 StepCard 標題下方
- [x] **連結更新**為 `https://aistudio.google.com/generate-speech?model=gemini-2.5-pro-preview-tts`

### 25.5 align-podcast duration 修正（Plan G）
- [x] **前端 `runAlignPodcast()` 傳入 `duration`**：呼叫 `getAudioDuration(podcastBlob)` 取得實際音訊長度作為 `clientDuration`
- [x] **`app/api/align-podcast/route.ts` 使用 `clientDurationSafe` 為最高優先**：依序 fallback 至 Whisper `transcriptionDuration` → Gemini SRT `lastSrtEnd`
- [x] **safety floor `Math.max(totalDuration, lastSrtEnd)`**：確保 SRT 最後一筆 end 不超出時間軸
- [x] **`AlignPodcastDiagnostics` 新增 4 欄位**（`lib/types.ts`）：`clientDuration` / `transcriptionDuration` / `lastSrtEnd` / `finalTotalDuration`
- [x] **Script fallback 路徑補入 `clientDurationSafe` 優先**（expert review 修正）

## 26. 2026-04-19 Plan H：SrtReviewPanel seek/play 時序修正

- [x] **新增 `pendingSeekRef` / `shouldAutoplayAfterSeekRef`**（`components/SrtReviewPanel.tsx`）：兩個 ref 分別記錄 pending seek 目標與「seek 前是否正在播放」
- [x] **`seekTo()` 改版**：不再立刻 `play()`；記錄 `!audio.paused` → `shouldAutoplayAfterSeekRef`，先更新 UI state，再設 `audio.currentTime`
- [x] **`handleSeeking`**：只做 `setCurrentTime()` + console.log，不判斷 play
- [x] **`handleSeeked`**：更新 currentTime；若 `shouldAutoplayAfterSeekRef` 為 true 則 play，play 前先清掉兩個 ref；否則只清 `pendingSeekRef`
- [x] **`handleCanPlay`（保底）**：只在 `pendingSeekRef !== null && shouldAutoplayAfterSeekRef` 同時成立時觸發 play，觸發後立即清掉兩個 ref，防止重入
- [x] **`<audio>` 綁定 `onSeeking` / `onSeeked` / `onCanPlay`**
- [x] **`scrollIntoView` 改為 `behavior: 'instant'`**：避免拖拉時 smooth scroll 造成視覺混亂
- [x] **所有 `play()` 加 `.catch(() => {})`**：防止 autoplay policy UnhandledRejection

## 27. 2026-04-19 Plan I：外部上傳 Podcast 音檔標準化為 MP3

### 27.1 後端 API（`app/api/normalize-podcast-audio/route.ts`，新建）
- [x] **接收 `{ audioBase64, mimeType }`**，支援 wav / m4a / aac 來源
- [x] **FFmpeg 轉碼**：`-ac 1 -ar 24000 -b:a 128k`（mono / 24000 Hz / 128 kbps MP3）
- [x] **`getFFmpegBinary()`**：共用 `VIDEO_FFMPEG_BIN` env，Windows 本地開發與 Docker/Cloud Run 均相容
- [x] **暫存目錄 `/tmp/podcast-normalize`**，`finally` 區塊雙檔 unlink 確保清理
- [x] **轉檔失敗回 500 明確錯誤**，不 silently fallback；`maxDuration=120`
- [x] **body size 限制 80MB**（50MB 檔案 base64 後 ≈ 67MB，加安全餘裕）

### 27.2 前端（`app/page.tsx`）
- [x] **`handlePodcastUpload()` 條件式標準化**：`isMp3File()` 為 true 直接用原始檔；否則 chunked base64 編碼（8192 bytes/chunk，防大檔 stack overflow）POST 到 normalize API
- [x] **標準化後 blob 設為 `podcastBlob`**（type: `audio/mpeg`）；`podcastSource` 維持 `'upload'`
- [x] **Toast 區分**：`已完成標準化並上傳：{file.name}` vs `已上傳音訊：{file.name}`
- [x] **`logUsage()` 接入**（後端）：`normalize-podcast-audio` 行為已記錄

## 28. 2026-04-19 Plan A 完成項目（SRT 字幕文字可編輯 + MP4 字幕同步修正）

### 28.1 `SrtReviewPanel` Prop 擴充與子元件化（`components/SrtReviewPanel.tsx`）
- [x] **新增兩個可選 props**：`onEntryTextChange?: (id: number, text: string) => void` 與 `onEntryBlur?: () => void`；optional 確保既有呼叫不壞
- [x] **`<span>{entry.text}</span>` 換為 `<AutoResizeTextarea>`**：使用者可直接點擊修改字幕文字，時間軸維持不可調整
- [x] **新增 `AutoResizeTextarea` 子元件**：以 `useLayoutEffect([value])` 在 value 變更時重算 `scrollHeight`，避免 inline ref callback 每次 render 都觸發 `null → el` 的全域 reflow
- [x] **`onClick stopPropagation`**：防止點字幕文字觸發外層 row 的 `seekTo`；`onFocus` 刻意不掛 `seekTo`，避免干擾目前播放進度
- [x] **UI hint 補強**：面板標題下方新增 `text-[10px] leading-relaxed` 說明文字「✎ 字幕文字可直接點擊修改（時間軸不可調整）。編輯完成後點擊面板外會自動儲存，並清除舊的簡報／影片快取以便重新生成。」；Podcast / Music 兩個面板共用同一段說明

### 28.2 `app/page.tsx` Handler 與 ref 同步
- [x] **新增 `podcastSrtEntriesRef` / `musicSrtEntriesRef`**：`useRef<SrtEntry[]>([])`，供 `onBlur` 寫 IndexedDB 時讀到最新 entries（解 same-tick onChange → onBlur 的 stale closure）
- [x] **`useEffect` 同步 ref**：`[podcastSrtEntries]` / `[musicSrtEntries]` 更新時同步 `ref.current`，涵蓋對齊重跑、loadRecord 等非 onChange 路徑
- [x] **`handlePodcastSrtEntryChange(id, text)` / `handleMusicSrtEntryChange(id, text)`**：在 `setXxxSrtEntries(prev => ...)` 的 updater 內同步寫入 `ref.current = next`（同 tick 讀取保證最新），避免在 updater 內做 side-effect
- [x] **`handlePodcastSrtBlur()` / `handleMusicSrtBlur()`**：清除 `xxxPptxBlob` / `xxxVideoBlob` state，讀 `ref.current` 呼叫 `updateRecord()` 同步寫入 IndexedDB；刻意不清 `xxxSrtConfirmed`（對齊確認狀態保留）

### 28.3 MP4 / PPTX cache 失效 + `srtConfirmed` 保留
- [x] **Blur 清 pptx / video blob**：state 與 IndexedDB 雙清，下一次生成時強制使用最新字幕文字
- [x] **`srtConfirmed` 不重設**：使用者若已確認過 SRT 時間對齊，純改字不該強迫重新進入對齊確認流程，設計上明確保留

### 28.4 VideoExportBlock 字幕來源修正（關鍵 bug fix）
- [x] **`podcastSrtForDownload` / `musicSrtForDownload` 條件放寬**（`app/page.tsx`）：原本要求 `slideCues.length > 0`，現改為 `entries.length > 0`，確保純 SRT 編輯（未動 cue）也能重新序列化出最新字幕
- [x] **新增 `stripSlideTags()` helper**：以 regex `^(\d+)\s+\[slide-\d+\]` 移除 `1 [slide-0]` 格式的標記，回復為符合 SRT 規格的 `1`，避免 FFmpeg libass 解析失敗
- [x] **新增 `podcastSrtForBurn` / `musicSrtForBurn`**：`adjustSrtTimes(stripSlideTags(forDownload), srtOffset)` 依序套用 tag 移除與 offset 調整；兩個 `VideoExportBlock` 的 `srtText` prop 改傳 `forBurn` 變體
- [x] **修正症狀**：使用者編輯字幕後匯出 MP4，字幕實際燒入的是原始對齊版本 → 改用 `forBurn` 變體後正確燒入編輯後的最新字幕

### 28.5 文件與型別維持不變（明確不動範圍）
- [x] **`lib/types.ts` 未改**：`SlideTiming` 本來就無 `text` 欄位，純文字編輯不需改型別
- [x] **`lib/db.ts` 未改**：`updateRecord()` 既有 spread 行為即可正確寫入 `undefined` 清除欄位
- [x] **對齊 / 封裝邏輯未改**：Plan A 僅新增字幕文字編輯通道，不影響時間軸計算與 cue 解析
