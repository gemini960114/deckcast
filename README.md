# Podcast & Music Generator

一個 AI 驅動的內容生成工具，將 PDF 簡報自動轉換為 Podcast 音訊、AI 歌曲與同步簡報。

---

## 產品簡介

上傳一份 3–10 頁的 PDF 投影片，系統自動完成以下所有工作：

1. 解析每張投影片內容
2. 生成雙人 Podcast 對話文稿
3. 生成指定風格的歌詞
4. 用 AI 語音合成 Podcast 音檔（雙人 TTS）
5. 用 AI 作曲生成完整歌曲音檔
6. 呼叫 Gemini 分析音頻起點並輸出 Podcast 簡報
7. 呼叫 Gemini 分析音樂段落並輸出 音樂簡報

所有生成結果可逐一下載，簡報播放時與音訊同步啟動即可對齊。

---

## 主要功能

### PDF 解析
- 支援純文字與圖片型 PDF
- 由 Gemini AI 原生解析每頁內容，無需額外 OCR 工具
- 解析完成後顯示投影片清單供確認

### Podcast 文稿生成
- 雙人對話格式（Speaker 1 / Speaker 2）
- 每張投影片約 30–40 秒對話量
- 可自訂說話者角色、對話形式與語氣風格
- 對話輪數依內容自然決定

### 歌詞生成（14 種風格可選）
- 嚴格依照投影片段落順序編排
- 每段落標記時間戳記與對應投影片編號
- 時長依投影片數量自動調整（3 張 → 約 1:00，10 張 → 約 2:30–3:00）
- 採用歌曲結構與時間軸「雙層控制結構 (Dual-Layer Prompt)」，強制 AI 遵守起訖秒數，抗幻覺能力強。

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
- Speaker 1 / 2 各自對應不同聲音（可於設定選擇）
- 輸出 `podcast.wav`

### 歌曲音訊生成
- 使用 Google Lyria 3 AI 作曲模型
- 輸入歌詞（含段落標記），輸出完整歌曲
- 輸出 `music.mp3`

### PowerPoint 簡報生成（AI 精準對齊轉場）
- 直接使用 Gemini 模型（`gemini-3-flash-preview`）實際聆聽生成的 Podcast `wav` 與 Music `mp3` 音軌。
- 捨棄舊有「字數除法」的相對猜測，改為直接抓取詞句開始秒數（`vocalStartSec`）。搭配「文稿＋歌詞＋時間軸」的**三角定位法**進階交叉比對，徹底突破了歌詞文字中缺乏投影片頁碼的窘境。
- 若 AI 分配失敗或超時，具備防呆機制退回嚴謹的均分邏輯。
- PDF 每頁透過 Canvas 渲染為圖片，注入 XML 轉場效果 `<p:fade/>` 產生淡入特效。最後一張投影片自動關閉換頁計時器，避免播放結束時黑屏退出。

| 檔案 | 換頁時間計算方式 |
|---|---|
| `podcast_slides.pptx` | 依據 AI 聆聽逐字稿發生的絕對秒數推算換頁時間 |
| `music_slides.pptx` | 依據 AI 聆聽歌詞發生的絕對起點推算時間，完美對齊前奏與間奏 |

> 音訊不嵌入 PPTX。下載後將音訊與簡報同時啟動，即可同步播放。

---

## 可下載檔案

| 檔案 | 說明 | 解鎖時機 |
|---|---|---|
| `script.txt` | Podcast 對話文稿 | 文稿生成後 |
| `lyrics.txt` | 歌曲歌詞 | 歌詞生成後 |
| `podcast.wav` | Podcast 音訊 | 音訊生成後 |
| `music.mp3` | 歌曲音訊 | 音樂生成後 |
| `podcast_slides.pptx` | Podcast 同步簡報 | Step 6 完成後 |
| `music_slides.pptx` | 音樂同步簡報 | Step 7 完成後 |

---

## 操作流程

```
Step 0  設定 API Key、說話者角色、TTS 聲音、歌曲風格
  ↓
Step 1  上傳 PDF → 確認投影片清單
  ↓
Step 2  生成 Podcast 文稿
  ↓
Step 3  生成歌詞
  ↓
Step 4  生成 Podcast 音訊（約 30–60 秒）
  ↓
Step 5  生成歌曲音訊（約 30–60 秒）
  ↓
Step 6  AI 聆聽並產生 Podcast 簡報 (精準對齊)
  ↓
Step 7  AI 聆聽並產生 音樂 簡報 (精準對齊)
  ↓
下載所有檔案
```

每個步驟完成後才解鎖下一步。可重新生成單一步驟而不影響其他步驟。

---

## 設定說明（Step 0）

### Gemini API Key
- 填入自己的 Gemini API Key（BYOK — Bring Your Own Key）
- Key 僅儲存於瀏覽器 `sessionStorage`，關閉分頁後自動清除
- 不會傳送至伺服器儲存

### Podcast 文稿變數

| 欄位 | 預設值 |
|---|---|
| Speaker 1 描述 | 男生為節目主持人 |
| Speaker 2 描述 | 女生為高師大的老師 Mary 老師（具教學經驗，說明清楚） |
| 對話形式 | 採自然流暢的對話形式，具有節目感與互動感 |
| 語氣風格 | 語氣親切、易懂，適合一般聽眾 |

欄位留空時自動套用預設值。

### TTS 聲音選擇

| 角色 | 預設 | 可選 |
|---|---|---|
| Speaker 1 | Zephyr（Male） | Zephyr / Charon / Fenrir / Orus |
| Speaker 2 | Puck（Female） | Puck / Kore / Leda / Aoede |

---

## 技術架構

### 分層設計

| 層 | 技術 | 職責 |
|---|---|---|
| 前端 | React（Next.js App Router）+ TypeScript | UI、步驟狀態、IndexedDB 讀寫、PPTX 生成、檔案下載 |
| 前端核心套件 | `pdfjs-dist` | PDF 每頁渲染為圖片（Stage 1 壓縮預處理 + Stage 7 PPTX 頁面圖片） |
| 前端核心套件 | `pptxgenjs` | PPTX 生成與每頁自動換頁計時設定 |
| 後端 | Next.js API Routes | Gemini API Key 安全代理、接收 Base64 音頻供 AI 進行時間軸解析，設定 Payload 限制防過載 |
| AI 服務 | Google Gemini API | 文稿、歌詞、TTS、音樂生成 |
| 持久化 | 瀏覽器 IndexedDB | 儲存所有生成結果（文字、音訊 Blob、PPTX Blob） |

### 使用的 AI 模型

| 模型 | 用途 |
|---|---|
| `gemini-3-flash-preview` | PDF 解析、Podcast 文稿生成、歌詞生成 |
| `gemini-2.5-flash-preview-tts` | Multi-speaker TTS 音訊生成 |
| `lyria-3-pro-preview` | AI 歌曲生成 |

### 儲存策略

- **伺服器端：零儲存** — 容器重啟不影響使用者資料，不需要資料庫
- **`sessionStorage`** — 儲存 API Key，關閉分頁自動清除
- **`IndexedDB`** — 儲存所有生成內容，重新整理頁面後仍保留

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
2. **無環境變數依賴（No `.env` Storage）**：不管是跑在 Docker 或 Google Cloud Run，所有的伺服器主機都不需要設定、也不會存放你的私密金鑰，所有 API Key 皆由每一次的使用者請求 (`Request Headers`) 動態帶入。
3. **前端銷毀機制（Client-side Protection）**：使用者的 API Key 僅短暫儲存於瀏覽器當下分頁的 `sessionStorage`，只要關閉該網頁分頁就會立刻銷毀消失。

---

## 使用限制

- PDF 投影片數量：**3–10 張**
- 不支援使用者登入系統
- 不支援文稿或歌詞的手動編輯
- 不提供 Podcast 與音樂的混音
- 歷史紀錄僅限當前瀏覽器可見（存於 IndexedDB）

---

## 前置需求

- Node.js 18+
- Google Gemini API Key（需開通 `gemini-3-flash-preview`、`gemini-2.5-flash-preview-tts`、`lyria-3-pro-preview` 存取權限）

---

## 安裝與啟動

```bash
# 安裝相依套件
npm install

# 啟動開發伺服器
npm run dev

# ⚠️ 注意：若在 Windows 環境下遇到 Turbopack 異常崩潰 (exit code 0xc0000142)
# 請強制改用 Webpack 模式啟動：
# npm run dev -- --webpack
```

開啟瀏覽器至 `http://localhost:3000`，於 Step 0 填入 Gemini API Key 即可開始使用。

> 本專案無需設定 `.env` 檔案。API Key 採 BYOK 模式，直接於畫面的 Step 0 輸入，不依賴任何環境變數。

---

## 部署與發布

本專案支援多種部署方式，你可以依照需求選擇適合的環境。

### 方式 1：使用 Docker 容器化

適用於本地測試或自家伺服器：

```bash
# 1. 建立 Docker 映像檔
docker build -t deckcast-app .

# 2. 啟動容器（將系統 port 3000 指向容器）
docker run -p 3000:3000 -d deckcast-app
```
啟動後，於瀏覽器前往 `http://localhost:3000` 即可使用。

### 方式 2：使用 Docker Compose (推薦於私有伺服器部署)

專案內已附帶設定好的 `docker-compose.yml`（包含 Node 環境載入、啟動腳本、Port 3000 綁定，以及定時自動重新啟動設定）。
這是最乾淨、最不怕主機套件衝突的啟動方式。

```bash
# 1. 一鍵建置並在背景啟動所有服務（包含自動重啟機制）
docker compose up -d --build

# 2. 檢視運行狀態與 log 日誌
docker compose logs -f

# 3. 停止與關閉服務
docker compose down
```

啟動後，於瀏覽器前往 `http://localhost:3000` 即可使用。

### 方式 3：雲端部署 (Google Cloud Run)

建議在部署前先確保本地端 `npm run build` 不會產生 TypeScript 語法錯誤。

💡 **單行自動驗證與部署指令（推薦）：**
```bash
npm run build && gcloud run deploy deckcast --source . --region asia-east1 --project gen-lang-client-0039151647 --allow-unauthenticated
```
> *(附註：`&&` 代表只有本地建置成功過關，才會往雲端拋送部署，以免浪費雲端額度與等待時間。)*

---

## 完成條件（Definition of Done）

使用者可以：

- 填寫設定或使用預設值
- 上傳 PDF 並確認投影片內容
- 生成 Podcast 對話文稿並預覽
- 生成歌詞並預覽
- 生成 Podcast 音訊並播放
- 生成歌曲音訊並播放
- 下載文稿、歌詞、音訊、PPTX 等全部 6 份輸出
- 重新整理頁面後歷史紀錄仍存在
