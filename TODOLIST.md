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
- [x] 將 Step 0 設定區擴充為模型下拉選單：`Step 1 / 2 / 4 / 5 / 7` 可選 `gemini-3.1-pro-preview` / `gemini-3-flash-preview` / `gemini-2.5-flash`，`Step 3` 可選 `gemini-2.5-pro-preview-tts` / `gemini-2.5-flash-preview-tts`，`Step 6` 目前固定 `lyria-3-pro-preview`
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

## 6. 後期測試與邊界除錯
- [x] 清理舊程式碼：刪除不需要的手動 SRT 拼裝邏輯 (`extractSlideTexts`, `formatSrtTime`)
- [x] 移除舊有 `30-second` 短歌選項，並將 Step 6 統一收斂為 `lyria-3-pro-preview`
- [x] 確認並修改全站針對簡報頁數的文字提醒與邊界阻擋邏輯，目前統一為「3-15頁」
- [x] 全專案通過 TypeScript 嚴格型別檢查 (`tsc --noEmit`) 無錯誤
- [x] **音樂對齊 Prompt 精準化**：重寫 `GENERATE_MUSIC_SRT`，明確分工「lyrics = 唯一正確文字來源，audio = 只用來定位時間」，根除 AI 自行辨識歌詞導致文字失真的問題；強化 `FIND_TRANSITIONS_PROMPT`，補充前 6–8 字定錨關鍵字、前奏/間奏邊界處理、無標記時輸出空陣列等規則；`align-music/route.ts` 加入 Phase 1 獨立 try/catch 與 Phase 2 fallback 防呆機制
- [x] **歌曲錨點摘要重建**：`buildSlideAnchorSummary()` 改為逐行依 `[Slide N]` 聚合內容，正確支援新格式 `[Verse 1] [Slide 2]`
- [x] **Podcast / Music 對齊鏈一致化**：兩條鏈都改為 `Whisper/Gemini -> SRT -> startSrtId -> timings -> diagnostics`，並通過 lint / build 驗證

## 7. 2026-04-06 補充完成項目
- [x] 導入 `google-auth-library`，完成後端 Google ID token 驗證
- [x] 將 auth、Google Client ID、invitation code、session secret 全部納入 `.env.local` 管理
- [x] 補強 `apiFetch` 未授權分類：區分 `auth` 失效與 `API Key` 失效，前端可分別提示
- [x] 修正 Podcast 生成 route 的音訊回傳型別，確保 Next.js build 通過
- [x] 將前端選擇的模型值一路傳入各 API route，讓 Step 1 / 2 / 4 / 5 / 7、Step 3、Step 6 不再寫死模型
- [x] 將 `README.md` / `SPEC.md` / `TODOLIST.md` 同步更新為 `3-15頁` PDF 上限與可切換模型規格
