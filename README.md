# DeckCast

一個 AI 驅動的內容生成工具，將 PDF 簡報自動轉換為 Podcast 音訊、AI 歌曲與同步簡報。

👉 **線上展示：[DeckCastAI 簡報語音生成器 - 讓簡報開口說話 · AI 簡報語音生成器](https://deckcast.biobank.org.tw/)**

---

## 產品簡介

上傳一份 3-15 頁的 PDF 投影片，系統自動完成以下所有工作：

1. 解析每張投影片內容
2. 生成雙人 Podcast 對話文稿
3. 生成或上傳 Podcast 音訊
4. 呼叫 AI 將 Podcast 音訊精準對齊成同步簡報
5. 生成指定風格的歌詞
6. 生成或上傳歌曲音訊
7. 呼叫 AI 將歌曲音訊精準對齊成同步簡報

所有生成結果可逐一下載，簡報播放時與音訊同步啟動即可對齊；也支援下載 SRT 與手動微調 offset 後重新封裝 PPTX。

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
- 每段落使用機器解析友善格式：`[段落名稱] [Slide N]`
- 不允許 AI 自行加入時間戳記，最終時間由 Whisper/Gemini 實際聆聽音訊後決定
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
- Speaker 1 / 2 各自對應不同聲音（可於設定選擇）
- 也支援上傳外部產製音訊（`mp3 / wav / m4a / aac`，50MB 以內）
- 下載時會保留與原始 blob 相符的副檔名
- 若想在外部先生成再回來上傳，可使用 [Google AI Studio Speech](https://aistudio.google.com/generate-speech?model=gemini-2.5-flash-preview-tts)

### 歌曲音訊生成
- 使用 Google Lyria 3 AI 作曲模型
- 輸入歌詞（含段落標記），輸出完整歌曲
- 輸出 `music.mp3`
- 也支援上傳外部歌曲音訊（目前維持 `mp3`，20MB 以內）
- 若想在外部先生成再回來上傳，可使用 [Producer.ai](https://www.producer.ai/invite/XH4T5Q)

### PowerPoint 簡報生成（AI 精準對齊轉場）
- 後端採用 **兩階段對齊流程**：先產出/修正 SRT，再根據 `startSrtId` 找出每張投影片第一次進入的字幕位置。
- `Step 4` 與 `Step 7` 皆可拆分為：
  - `4.1 / 7.1`：多模態理解（音訊 + 參考文本），固定使用 Gemini 系列
  - `4.2 / 7.2`：文字對齊（script/lyrics + SRT），可使用 Gemini 或本地 `gemma-4-31B-it`
- **歌曲對齊核心設計**：Phase 1 採「lyrics-as-anchor」策略，歌詞文字是唯一正確來源，音訊只負責定位時間。
- **Podcast 對齊核心設計**：以實際音訊為主、腳本為輔，先修正逐段字幕文字，再對應每張投影片開始的字幕 id。
- 若 AI 配對失敗或不足，系統仍會退回 `lyrics/script weight fallback` 或均分 fallback，避免流程中斷。
- PDF 每頁透過 Canvas 渲染為圖片，注入 XML 轉場效果 `<p:fade/>` 產生淡入特效。
- 第一頁嵌入的音訊物件會額外補寫 `<p:timing>`，讓 PowerPoint 更接近「開場自動播放 + 跨頁持續播放」的行為。
- 最後一頁仍會保留 `advTm`，並在原本時長後額外多等 2 秒再跳向不存在的下一頁，方便後續輸出為影片時保留結尾停留時間。

| 檔案 | 換頁時間計算方式 |
|---|---|
| `podcast_slides.pptx` | 依據對齊後 SRT 與 `startSrtId` 推算換頁時間，並將音訊嵌入第一頁與補寫 timing XML |
| `music_slides.pptx` | 依據歌詞錨點、對齊後 SRT 與 `startSrtId` 推算換頁時間，並將音訊嵌入第一頁與補寫 timing XML |

> 目前程式已補寫 PowerPoint timing XML，實務上更接近「第一頁自動播放、跨頁持續播放」。但不同版本的 PowerPoint 相容性仍可能有差異；若播放行為不如預期，保守做法仍是下載後將音訊與簡報同時啟動。

---

## 可下載檔案

| 檔案 | 說明 | 解鎖時機 |
|---|---|---|
| `script.txt` | Podcast 對話文稿 | 文稿生成後 |
| `lyrics.txt` | 歌曲歌詞 | 歌詞生成後 |
| `podcast.wav` / `podcast.mp3` / `podcast.m4a` | Podcast 音訊 | 音訊生成或上傳後 |
| `music.mp3` | 歌曲音訊 | 音樂生成後 |
| `podcast.srt` | Podcast 字幕 | Podcast 對齊完成後 |
| `music.srt` | 音樂字幕 | 音樂對齊完成後 |
| `podcast_slides.pptx` | Podcast 同步簡報 | Step 4 完成後 |
| `music_slides.pptx` | 音樂同步簡報 | Step 7 完成後 |

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
  ↓
Step 5  生成歌詞
  ↓
Step 6  生成或上傳歌曲音訊（約 30–180 秒）
  ↓
Step 7  AI 聆聽並產生 音樂 簡報 (精準對齊)
  ↓
下載所有檔案
```

每個步驟完成後才解鎖下一步。可重新生成單一步驟而不影響其他步驟，也可在對齊完成後調整 SRT offset 再重新封裝 PPTX。

---

## 設定說明（Step 0）

### Gemini API Key
- 填入自己的 Gemini API Key（BYOK — Bring Your Own Key）
- Key 僅儲存於瀏覽器 `sessionStorage`，關閉分頁後自動清除
- 不會傳送至伺服器儲存
- 可從 [Google AI Studio API Keys](https://aistudio.google.com/api-keys) 取得

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

### 模型選擇

- `Step 1 / 4.1 / 7.1`：`gemini-3.1-pro-preview` / `gemini-3-flash-preview`（預設）/ `gemini-2.5-flash`
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
| Step 1 / 4.1 / 7.1 | `gemini-3.1-pro-preview` / `gemini-3-flash-preview`（預設）/ `gemini-2.5-flash` |
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

- PDF 投影片數量：**3-15 張**
- 不支援文稿或歌詞的手動編輯
- 不提供 Podcast 與音樂的混音
- 歷史紀錄僅限當前瀏覽器可見（存於 IndexedDB）；若 auth 啟用則依 Google 帳號隔離

---

## 前置需求

- Node.js 20+（與 Dockerfile 一致）
- Google Gemini API Key
  - 至少需開通 `gemini-3-flash-preview`、`gemini-2.5-flash-preview-tts`、`lyria-3-pro-preview`
  - 若要切換其他下拉模型，還需具備 `gemini-3.1-pro-preview`、`gemini-2.5-flash`、`gemini-2.5-pro-preview-tts` 的存取權限
- 若要啟用登入：Google OAuth Client ID、invitation code、session secret

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
```

說明：
- `AUTH_ENABLED=false` 時，`INVITATION_CODE` / `SESSION_SECRET` / Google Client ID 可先不填
- 若不使用 Whisper 對齊，可先不填 `NCHC_WHISPER_*`；系統會退回 Gemini-only 或 fallback 流程
- `LOCAL_LLM_*` 為選配，供 `Step 2 / 4.2 / 5 / 7.2` 這類純文字推理步驟改接本地 OpenAI-compatible 模型
- 只有在 `LOCAL_LLM_BASE_URL` 與 `LOCAL_LLM_API_KEY` 都存在時，設定區第二組模型下拉才會顯示本地模型選項
- 若 `LOCAL_LLM_BASE_URL` 已直接填到 `/chat/completions`，程式會直接使用；若只填到 `/v1`，則會自動補上 `/chat/completions`
- `LOCAL_LLM_MODEL` 為本地模型實際送出的模型名稱，若有設定，會優先覆蓋前端同組下拉選單的本地模型值
- `LOCAL_LLM_LABEL` 為 UI 顯示名稱；例如你可以把 `gemma-4-31B-it` 顯示為 `Gemma 4 31B (Custom)`
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

### 方式 3：雲端部署 (Google Cloud Run)

建議在部署前先確保本地端 `npm run build` 不會產生 TypeScript 語法錯誤。

正式部署建議直接使用 repo 內建的 `cloudbuild.yaml`。它現在已經會：
- 在 Docker build 時帶入 `NEXT_PUBLIC_AUTH_ENABLED`、`NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- 在 Cloud Run deploy 時帶入 auth、Whisper 與本地 OpenAI-compatible LLM 所需的 runtime env vars

若你要部署較高承載版本，也可以改用 [cloudbuild_500.yaml](./cloudbuild_500.yaml)。這份設定會額外指定：
- `deckcast500` 作為獨立 Cloud Run 服務名稱
- `CPU=4`
- `Memory=4Gi`
- `Concurrency=8`
- `Min instances=3`
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
gcloud builds submit --config cloudbuild.yaml "--substitutions=_AUTH_ENABLED=true,_NEXT_PUBLIC_AUTH_ENABLED=true,_INVITATION_CODE=1234,_SESSION_SECRET=1234,_GOOGLE_CLIENT_ID=57229660377-v7jstv378vq150lpn8bt32afsubde7ki.apps.googleusercontent.com,_NEXT_PUBLIC_GOOGLE_CLIENT_ID=57229660377-v7jstv378vq150lpn8bt32afsubde7ki.apps.googleusercontent.com,_NCHC_WHISPER_API_KEY=1234,_NCHC_WHISPER_MODEL=whisper-Breeze-ASR-25,_NCHC_WHISPER_URL=https://portal.genai.nchc.org.tw/api/v1/audio/transcriptions,_LOCAL_LLM_BASE_URL=https://portal.genai.nchc.org.tw/api/v1/chat/completions,_LOCAL_LLM_API_KEY=1234,_LOCAL_LLM_MODEL=gemma-4-31B-it,_LOCAL_LLM_LABEL=Gemma 4 31B (Custom)"
```

若你要部署高承載版本，改用：

```bash
gcloud builds submit --config cloudbuild_500.yaml "--substitutions=_AUTH_ENABLED=true,_NEXT_PUBLIC_AUTH_ENABLED=true,_INVITATION_CODE=1234,_SESSION_SECRET=1234,_GOOGLE_CLIENT_ID=57229660377-v7jstv378vq150lpn8bt32afsubde7ki.apps.googleusercontent.com,_NEXT_PUBLIC_GOOGLE_CLIENT_ID=57229660377-v7jstv378vq150lpn8bt32afsubde7ki.apps.googleusercontent.com,_NCHC_WHISPER_API_KEY=1234,_NCHC_WHISPER_MODEL=whisper-Breeze-ASR-25,_NCHC_WHISPER_URL=https://portal.genai.nchc.org.tw/api/v1/audio/transcriptions,_LOCAL_LLM_BASE_URL=https://portal.genai.nchc.org.tw/api/v1/chat/completions,_LOCAL_LLM_API_KEY=1234,_LOCAL_LLM_MODEL=gemma-4-31B-it,_LOCAL_LLM_LABEL=Gemma 4 31B (Custom)"
```

#### 補充說明

- `GOOGLE_CLIENT_ID`、`INVITATION_CODE`、`SESSION_SECRET` 是 auth 啟用時必需的 server-side 參數
- `NCHC_WHISPER_*` 會影響 Whisper 對齊能力；未設定時仍可退回非 Whisper 路徑，但精準度可能下降
- `LOCAL_LLM_*` 為選配；只有在你要讓 `Step 2 / 4.2 / 5 / 7.2` 走本地 OpenAI-compatible 模型時才需要提供
- `LOCAL_LLM_LABEL` 可自訂 Cloud Run 畫面顯示名稱；例如 `Gemma 4`、`Qwen 32B`
- `NEXT_PUBLIC_AUTH_ENABLED`、`NEXT_PUBLIC_GOOGLE_CLIENT_ID` 屬於前端 build-time 變數；請透過 Cloud Build substitutions 或其他建置環境變數在 build 時注入
- `cloudbuild.yaml` 內建的是可直接使用的預設值；正式部署前務必以 substitutions 覆蓋 `change-me` 類型參數
- `LOCAL_LLM_BASE_URL` 若填到 `/v1`，程式會自動補成 `/chat/completions`；若你已直接提供完整的 `/chat/completions` 端點，也可以直接使用
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
- 重新整理頁面後歷史紀錄仍存在，且 auth 啟用時會依 Google 帳號隔離
