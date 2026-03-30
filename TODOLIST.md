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

## 3. 基礎模型與提示詞 (Prompts) 架構
- [x] 定義所有支援模型：指定 `gemini-3-flash-preview`, `lyria-3-pro-preview`, 與多聲道 TTS 模型
- [x] 製作「Podcast 雙人對話腳本」提示詞 (支援注入 Speaker 1、Speaker 2、風格、語氣自訂)
- [x] 製作「雙層控制結構 (Dual-Layer Prompt)」歌詞提示詞，嚴格控制起訖時間確保音樂長度不暴走
- [x] 新增 `normalizeTimings` 時間校正引擎，建立遇到 API 解析錯誤時的防呆數學退路

## 4. API 路由與雲端 AI 介接實作
- [x] `POST /api/parse-pdf`: 提供 PDF 圖片交由 Gemini 快速 OCR 視覺解析文字
- [x] `POST /api/generate-script`: 依據 PDF 簡報內容生成 Podcast 逐字稿
- [x] `POST /api/generate-lyrics`: 依據投影片段落生成分秒精準的 AI 歌詞
- [x] `POST /api/generate-podcast`: 介接 Gemini Multi-speaker TTS，順利將單一文字雙人扮演回傳 `audio/wav`
- [x] `POST /api/generate-music`: 呼叫 Lyria 3 作曲，實作了「無序 parts 防呆迴圈安全解析」抓取 `audio/mp3`
- [x] `POST /api/align-podcast` & `/api/align-music`: 實作 2-step AI 高端聽寫。特別在音樂對齊階段導入「三角定位法」，用原始文稿輔助 AI 推理歌詞對應的頁碼與精確轉場時間。

## 5. 前端流程 UI 與簡報 (PPTX) 渲染
- [x] 實作嚴謹的順序解鎖流程流：(1)上傳 PDF (限 3-10頁) -> (2)腳本文稿 -> (3)歌詞 -> (4)Podcast音訊 -> (5)音樂音訊 -> (6)同步簡報
- [x] 前端串接：捨棄前端猜測秒數，直接提取後端回傳的 `vocalStartSec` 絕對時間軸資料
- [x] `lib/generatePptx.ts`: 利用瀏覽器 Canvas 把唯讀的 PDF 高解析度渲染轉換為單張圖片
- [x] 自動在 PPTX 第一頁左上角注入 `.wav` 或 `.mp3` 多媒體音訊物件
- [x] 動態替換 PPTX 底層 XML，對全投影片注入 `<p:fade/>` 淡化轉場，並獨立關閉「最後一頁」的自動換頁計時器避免黑屏退出

## 6. 後期測試與邊界除錯
- [x] 清理舊程式碼：刪除不需要的手動 SRT 拼裝邏輯 (`extractSlideTexts`, `formatSrtTime`)
- [x] 移除舊有 `30-second` 短歌選項，全盤統一改用更智能涵蓋所有時長的 `MODEL_MUSIC_PRO`
- [x] 確認並修改全站針對簡報「5-10頁」的文字提醒與邊界阻擋邏輯，全部降為「3-10頁」
- [x] 全專案通過 TypeScript 嚴格型別檢查 (`tsc --noEmit`) 無錯誤
- [x] **音樂對齊 Prompt 精準化**：重寫 `GENERATE_MUSIC_SRT`，明確分工「lyrics = 唯一正確文字來源，audio = 只用來定位時間」，根除 AI 自行辨識歌詞導致文字失真的問題；強化 `FIND_TRANSITIONS_PROMPT`，補充前 6–8 字定錨關鍵字、前奏/間奏邊界處理、無標記時輸出空陣列等規則；`align-music/route.ts` 加入 Phase 1 獨立 try/catch 與 Phase 2 fallback 防呆機制
