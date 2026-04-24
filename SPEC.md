# DeckCast — spec_v04

> 本文件供 LLM 閱讀，從零重現此專案。包含完整架構、所有程式碼、遇到的問題與解法。

### ✨ v24 補充亮點（2026-04-24，字幕外觀三選一）：
1. **`SubtitleStyle` 型別**（`lib/videoExport.ts`）：`'opaque' | 'translucent' | 'outline'`；`DEFAULT_SUBTITLE_STYLE = 'opaque'` 保留現況不改變老客戶行為。
2. **`buildSubtitleStyle(variant)` function 取代舊 `SUBTITLE_STYLE` 常數**：
   - `opaque` → `Fontname=Noto Sans CJK TC,Fontsize=22,BackColour=&HB0000000,BorderStyle=3,Outline=1,Shadow=0`（與 v21 相同）
   - `translucent` → `Fontname=Noto Sans CJK TC,Fontsize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&HF8000000,BorderStyle=3,Outline=1,Shadow=0`（~2% 不透明 + 白字黑邊）
   - `outline` → `Fontname=Noto Sans CJK TC,Fontsize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0`（無 banner、純白字黑邊）
3. **`GenerateVideoParams` 新增 `subtitleStyle?: SubtitleStyle`**；`buildConcatArgs` / `buildXfadeArgs` 皆透傳並在 filter 中以 `force_style='${buildSubtitleStyle(variant)}'` 套用。
4. **`/api/export-video` 接收並驗證 `subtitleStyle`**：新增 `SUBTITLE_STYLES` readonly 陣列 + `isSubtitleStyle()` runtime guard，合法值才傳給 `generateVideo()`，非法值 fallback 到 `undefined`（即 `opaque`）。
5. **`VideoExportBlock.tsx` UI 新增「字幕外觀」select**：勾選「燒入字幕」後才顯示；state 為 `useState<SubtitleStyle>('opaque')`；每個選項附一行說明文字（`SUBTITLE_STYLE_HINT` map）。切換樣式時呼叫 `onClearCache()`，確保不同樣式之間不共用快取。
6. **Request payload 追加 `subtitleStyle`**：`burnSubs && hasSrt` 為 true 時才傳；否則不送欄位，維持 API 向下相容。
7. **設計決策**：預設保留 `opaque` 不改預設，避免現有客戶視覺被動改變；抱怨字幕 banner 遮住投影片的客戶會主動切換為 `translucent` 或 `outline`。

### ✨ v23 補充亮點（2026-04-19，Plan I 外部上傳音檔標準化 + Plan H seek/play 時序修正）：
1. **外部上傳 Podcast 音檔條件式標準化（Plan I）**：上傳 wav / m4a / aac 時，前端自動將音檔 POST 至新 API `/api/normalize-podcast-audio`，由後端 FFmpeg 轉成標準 MP3（mono / 24000 Hz / 128 kbps）後回傳；mp3 來源不重編碼，直接使用原始檔；播放器、字幕確認、對齊三者均使用同一份標準化後 blob，消除外部音檔格式差異造成的 seek 不穩定問題。
2. **新增 `app/api/normalize-podcast-audio/route.ts`**：接收 `{ audioBase64, mimeType }`，呼叫系統 ffmpeg（Docker/Cloud Run 已內建，無需額外安裝），`finally` 區塊確保 tmp 暫存檔一定清除；轉檔失敗直接回 500 明確錯誤，不 silently fallback；`maxDuration=120` 防超時。
3. **`handlePodcastUpload()` 改版**（`app/page.tsx`）：加入 `isMp3File()` 判斷；非 mp3 時以 chunked base64 編碼（每次 8192 bytes，避免大檔 stack overflow）送出標準化請求；成功後 toast 顯示「已完成標準化並上傳」vs「已上傳音訊」區分兩條路徑；`podcastSource` 維持 `'upload'`，不影響後續對齊流程。
4. **`SrtReviewPanel` seek/play race condition 修正（Plan H）**：新增 `pendingSeekRef` / `shouldAutoplayAfterSeekRef` 兩個 ref；`seekTo()` 不再立刻呼叫 `audio.play()`，而是記錄原本播放狀態後，等 `handleSeeked` 或 `handleCanPlay` 確認 seek 完成才觸發 play；暫停狀態下點字幕不會強制播放；`scrollIntoView` 改為 `instant`；所有 `play()` 加 `.catch(() => {})`；新增 debug console.log 方便驗證事件順序。

### ✨ v22 補充亮點（2026-04-19，align-podcast duration 修正 + UI 設定遷移）：
1. **align-podcast 時間軸修正（Plan G）**：前端 `runAlignPodcast()` 新增取得音訊實際 duration（`getAudioDuration()`），作為 `duration` 欄位傳入 align-podcast API；後端以 `clientDurationSafe` 為最高優先來源，依序 fallback 至 Whisper transcriptionDuration、Gemini SRT lastSrtEnd；safety floor `Math.max(totalDuration, lastSrtEnd)` 確保 SRT 最後一筆 end 不超出時間軸；`AlignPodcastDiagnostics` 新增 4 個欄位供診斷。
2. **UI 設定欄位遷移**：歌曲風格/歌詞長度遷入 Step 5；Speaker Voice 1/2 遷入 Step 3 API 生成區；表達模式/Speaker/對話形式/語氣風格/旁白長度/長度補充說明遷入 Step 2；設定區保留內容語言作為全域選項。
3. **TTS 估時係數修正**：`CHARS_PER_MIN` 調整為 1.5 倍（duo: 330 / solo_explainer: 345 / solo_story: 300），警示門檻同步調高（`TTS_WARN_SEC: 200` / `TTS_LONG_SEC: 320`）。
4. **預設值調整**：`DEFAULT_SPEAKER1 = '阿哲'`；`DEFAULT_SPEAKER2 = 'Mary 老師'`；`DEFAULT_NARRATION_LENGTH_PRESET = 'brief'`；Step 3 上傳提示文字改為「建議至」並更新連結至 `gemini-2.5-pro-preview-tts`。

### ✨ v21 補充亮點（2026-04-19，燒入字幕功能 + cachedFilename 檔名流程）：
1. **燒入字幕（Burn Subtitles）**：匯出 MP4 前可勾選「燒入字幕」，FFmpeg `subtitles=` filter 將 SRT 永久嵌入畫面；預設不勾選，仍可另行下載 `.srt`；勾選後下載檔名自動加 `.subbed` 後綴（`podcast.subbed.mp4` / `music.subbed.mp4`）。
2. **`cachedFilename` prop + `onCached(blob, filename)` 簽名**（`components/VideoExportBlock.tsx`）：`onCached` 從 `(blob) => void` 改為 `(blob, filename) => void`，將燒入字幕時的實際檔名一路傳回 `page.tsx`；`cachedFilename` prop 確保「再次下載」與下載總覽均使用正確的 `.subbed.mp4` 或 `.mp4` 名稱。
3. **`podcastVideoFilename` / `musicVideoFilename` state**（`app/page.tsx`）：新增兩個 `useState<string | null>` 追蹤快取影片的實際檔名；下載總覽的影片按鈕改為顯示並下載 `filename ?? buildTaggedName(...)`，完整反映燒字幕狀態。
4. **React Hooks 規則修正**（`components/VideoExportBlock.tsx`）：`hasSrt` 計算與 `useEffect`（`hasSrt` 消失時自動清除 `burnSubs`）移至 `if (!videoExportEnabled) return null` early return 之前，符合 React Hooks 規則，無條件執行。
5. **`getExportFilename()` helper**：`burnSubs` 為 true 且有 SRT 時，將 `.mp4` 後綴替換為 `.subbed.mp4`，產生與快取 key 不同的檔名，避免燒字幕版與原版快取衝突。
6. **FFmpeg subtitle filter 實作**（`lib/videoExport.ts`）：寫入暫存 `subtitles.srt`；`escapeSrtPath()` 處理 Windows 路徑反斜線與冒號跳脫；`force_style` 指定 `Noto Sans CJK TC` 字型、半透明背景（`BackColour=&HB0000000, BorderStyle=3`）；xfade 模式下以 `[vxf]` 中間節點串接 subtitle filter，concat 模式下直接附加至 `-vf`。
7. **Docker 字型支援**（`Dockerfile`）：runner stage 新增 `fontconfig font-noto-cjk`，確保容器內燒入繁中字幕不缺字。

### ✨ v20 補充亮點（2026-04-19，plan_D SRT 優先架構 + D13 縮圖預覽 + D14 cue 排序輸出）：
1. **SRT 優先（SRT-first）架構**：對齊完成後新增兩階段人工確認流程——先在 `SrtReviewPanel` 確認 SRT 字幕內容，再透過 `SrtCueEditor` 指定每張投影片的換頁起始字幕列，最後才生成 PPTX；任何上游變動會自動廢止下游確認狀態。
2. **`SrtSlideCue / SlideCueEvent` 兩階段 cue 資料模型**（`lib/types.ts`、`lib/timing.ts`）：`SrtSlideCue {srtId, slideIndex}` 儲存使用者標記；`buildSlideCueEvents()` 對應時間戳；`buildTimingsFromSlideCueEvents()` 衍生 `SlideTimings`（長度 = cue 數 = SRT `[slide-N]` 標籤數）。
3. **D13 換頁標記縮圖預覽**（`components/SrtCueEditor.tsx`）：chip bar 與 SRT 列表之間插入 140×79px（16:9）縮圖區；使用者第一次點擊 chip 才觸發 `pdfToJpegBase64(pdfBlob, 0.3)` 延遲渲染（低畫質、省記憶體），之後快取不重跑；渲染中顯示 `animate-pulse` 骨架。
4. **D14 cue 排序輸出**（`lib/generatePptx.ts`、`components/VideoExportBlock.tsx`）：新增 `buildOrderedImagesFromTimings(allImages, timings)` 函式，PPTX 與 MP4 的幀順序均依使用者 cue 的 `slideIndex` 重排，允許同一張投影片重複出現或以非 PDF 頁序呈現，且 `images.length === timings.length` 恆成立。
5. **關鍵 bug fix — PPTX 幀數 = cue 數**（`app/page.tsx`）：`buildPodcastPptxFromConfirmedSrt` / `buildMusicPptxFromConfirmedSrt` 當 `slideCues.length > 0` 時一律從 cues 重新計算 timings，不使用儲存於 state 的 `normalizeTimings` 輸出（長度 = PDF 頁數）；修正後 PPTX 投影片張數恆等於 SRT `[slide-N]` 標籤數，MP4 影片幀數亦然。
6. **`Array.isArray()` 防呆**（`app/page.tsx`）：舊版 IDB 紀錄的 timings 可能非陣列；所有呼叫 `.map()` 前加 `Array.isArray()` 檢查，修復 `TypeError: timings.map is not a function`。
7. **單元測試 32 個全過**（`__tests__/timing.test.ts`）：新增 25 個測試覆蓋 `buildSlideCueEvents` / `buildTimingsFromSlideCueEvents` / `buildSlideCuesFromVisualCueMatches` / `buildSlideCuesFromTransitionMatches` / `normalizeTimings`；與 `srt.test.ts` 合計 32 個，`npm test` 全數通過。

### ✨ v19 補充亮點（2026-04-18，plan_B cueIndex 架構 + plan_A 歌詞編修統一化）：
1. **`cueIndex` 段落定址契約**：歌曲對齊鏈全面改用 `cueIndex`（1..N 段落序號）取代 `slideIndex` 作為 Phase 2 定址 key；`slideIndex` 保留為資訊欄位，允許重複與回溯（多個段落可對應同一張投影片）。
2. **`[No Slide]` 移除**：歌詞視覺標記規則改為每個段落必須輸出 `[Slide N]`；`LyricVisualTag` 型別簡化為純 `{ kind: 'slide'; slideIndex: number }`，移除 `no-slide` union 分支。提供 fallback 規則：第一段無法判斷時用 `[Slide 1]`，中途不確定時延續前一段。
3. **`parseLyricSections()` / `buildVisualCueTimings()` 新函式**（`lib/timing.ts`）：section-based 解析與時間計算；`buildMusicFallbackTimingsByLyricsWeight()` 修正為接收原始 `lyrics`（而非 strip 後的 `structuredLyrics`），解決 section 標題消失導致 fallback 退化為等分的 bug。
4. **`buildVisualCueSummary()` / `parseVisualCueMatchesJSON()`**（`app/api/align-music/route.ts`）：取代 `buildSlideAnchorSummary` / `parseTransitionMatchesJSON`；前者輸出含 cueIndex 的段落摘要供 Phase 2 定址，後者驗證 cueIndex 範圍並排序。
5. **舊版 PPTX/MP4 相容**：route 推導 `legacyMatches`（每個 slideIndex 首次出現的 cue），用於現有 `SlideTimings` 路徑；全段落序列另存為 `visualCueTimings` 供未來 B-3 渲染使用。
6. **`handleSaveScriptEdit()` 統一化**（plan_A）：所有模式（`duo` / `solo_*`）儲存 script 後均清除 lyrics + Music 鏈，移除舊版「solo 不清 lyrics」分支；Step 5 同步新增 `isEditingLyrics` / `lyricsDraft` 雙軌歌詞後製編修，行為與 Step 2 對稱。

### ✨ v16 補充亮點（2026-04-17，plan_P 後製編修 Podcast 文稿方法功能）：
1. **Step 2 定位升級為「生成 + 後製編修」**：Podcast 文稿不再只是一次性 LLM 輸出，而是使用者可於 Step 2 直接進行後製潤稿、刪改句子、補強轉場、修正人名術語後，再作為 Step 3 / 4 的唯一正式上游。
2. **採用 draft / live script 雙軌模型**：編輯期間只改 `scriptDraft`，未儲存前不覆寫正式 `script`；可避免使用者一邊改稿、一邊誤觸後續音訊或對齊流程而造成資料競態。
3. **儲存後必須清除所有失效衍生物**：凡是依賴文稿內容的產物都視為 cache，包括 Podcast 音訊、SRT、timings、diagnostics、PPTX、MP4；`duo` 模式下連 lyrics / music 鏈也必須一併清空，因歌詞內容可能直接受文稿語氣影響。
4. **提供「後製再生成」主流程**：使用者操作順序為 `生成文稿 → 編輯文稿 → 儲存修改 → 重新生成 Podcast 音訊 → 重新 AI 對齊 → 重新下載 script / srt / pptx / mp4`；所有下載內容必須以最新儲存版本為準。
5. **IndexedDB 要保存編修後正式版本**：`updateRecord()` 在儲存文稿修改時同步寫回 `script` 與 `scriptGeneratedAt`，讓歷史紀錄、重新載入、下載命名時間標籤都指向最新人工編修版本，而非舊的 LLM 首次生成版本。
6. **UI 需明確提示影響範圍**：Step 2 編輯區應告知「儲存後會清除既有 Podcast 音訊 / 對齊 / 簡報，需重新生成」，降低使用者對資料被重設的意外感。
7. **未來可擴充為三段式能力**：`重新生成`（全部改寫）、`局部潤稿`（AI 針對選段改寫）、`手動編修`（textarea 直接改）；本期先以最穩定的手動編修為主，不引入選段 diff merge 複雜度。

### ✨ v15 補充亮點（2026-04-17，plan_D 生成後可手動編輯腳本）：
1. **`isEditingScript` / `scriptDraft` state**（`app/page.tsx`）：新增兩個 state 管理腳本編輯模式；`scriptDraft` 為暫存草稿，不影響 live `script`，取消時零成本清除。
2. **三個 handler**（`app/page.tsx`）：`handleStartScriptEdit()`（複製 script → draft，進入編輯）/ `handleCancelScriptEdit()`（清空 draft，不動正式腳本）/ `handleSaveScriptEdit()`（draft 寫回 script，清失效下游，更新 `scriptGeneratedAt`，同步 IndexedDB）。
3. **失效鏈清除**：儲存後一律清 Podcast 音訊、PPTX、SRT、timings、diagnostics、video（呼叫 `resetPodcastDerivedState()` + `setPodcastBlob(null)` + Step 3 / 4 state reset）；`duo` 模式才額外清 lyrics / lyricsGeneratedAt / musicBlob 及整條 music chain（呼叫 `resetMusicDerivedState()` + Step 5 / 6 / 7 state reset）；`solo_*` 模式不清 lyrics / music 系列。
4. **`scriptGeneratedAt` 同步更新**：手動儲存後更新為當下時間，使下載命名時間標籤反映最新版本，歷史紀錄不沿用舊 LLM 生成時間。
5. **Step 2 UI 改版**：正常模式加「編輯腳本」ActionBtn；編輯模式切換為固定高度 `<textarea>`（`min-h-[320px] max-h-[50vh]`，可捲動），含儲存警示小字與「儲存修改」/「取消」按鈕。
6. **Step 3~7 編輯期間全部 disabled**：所有 StepCard 的 `disabled` 條件加入 `|| isEditingScript`，防止 draft 與 live script 並存時操作後續流程。
7. **僅改 `app/page.tsx`**：不需修改 `lib/prompts.ts` / `lib/types.ts` / `lib/db.ts` / `app/api/generate-script/route.ts`，最小範圍實作。

### ✨ v14 補充亮點（2026-04-14，plan_N TTS 生成模式使用者選項）：
1. **`TtsGenerationMode` 新型別**（`lib/types.ts`）：`'single' | 'chunked'`，代表使用者選擇的 TTS 生成策略。
2. **Step 3 UI 新增 TTS 生成模式下拉**（`app/page.tsx`）：只在 `podcastInputMode === 'api' && ttsChunkingEnabled` 時顯示；選項 `不分段（音色較一致）`（預設 `single`）與 `自動分段（較不易破音）`（`chunked`）；`ttsChunkingEnabled=false` 時整個欄位隱藏。
3. **警示文案改由 `ttsGenerationMode` 驅動**：Step 3 長稿警示文案（`>= TTS_LONG_SEC` / `>= TTS_WARN_SEC`）改為依使用者目前選擇動態更新，取代舊版以系統 flag `ttsChunkingEnabled` 決定文案的方式。
4. **後端改由 request body 決定分段**（`app/api/generate-podcast/route.ts`）：解構新增 `ttsGenerationMode`（預設 `'single'`）；`serverAllowsChunking`（env flag）降為後端防呆 fallback，正常情況前端不會送出 `chunked`（選單在 `ttsChunkingEnabled=false` 時已隱藏）。
5. **`ttsChunkingEnabled` 語意降級**：原本影響分段決策的 server flag，現在只作為「是否顯示 TTS 生成模式選單」的 UI 能力旗標，不再直接控制後端行為。

### ✨ v13 補充亮點（2026-04-14，plan_O 內容語言強制約束強化）：
1. **`buildLanguageBlock()` 強化**：移除 `if (language === 'zh-TW') return ''` 特例；四種語言（`zh-TW / en / ja / ko`）均輸出完整語言 block，新增「主體內容不得改用其他語言作為主要輸出」約束句。三種腳本模式（雙人對談、單人講解、單人說故事）均已呼叫此函式，自動同步受益。
2. **新增 `buildLyricsLanguageBlock()`**（`lib/prompts.ts`，私有）：歌詞專用語言 block，比腳本更嚴格；刪除舊版「K-POP/J-POP 可保留少量混語」寬鬆句；分語言分支處理：`zh-TW / ja / ko` 明確禁止英文成為主體（含 `Do not use English as the primary language`），`en` 只要求英文為主體（不反向禁止，避免自相矛盾）。
3. **`buildLyricsPrompt()` 修正**：移除 `if (lang === 'zh-TW') return base` 提前 return；改為一律執行 `return base + buildLyricsLanguageBlock(lang)`，四種語言全部附加語言 block，不再有任何特例路徑。
4. **資料流不變**：`app/api/generate-script/route.ts` / `app/api/generate-lyrics/route.ts` / `app/page.tsx` 均已正確傳遞 `contentLanguage`，本次無需修改。

### ✨ v12 補充亮點（2026-04-14，plan_K PPTX/MP4 時序一致 + plan_L 下載命名）：
1. **PPTX/MP4 轉場時序統一（plan_K）**：新增 `resolveEffectiveTransitionSec()` 共用函式，PPTX 的 `buildTransitionAdjustedTimings()` 與 MP4 的 xfade offset 均透過此函式計算有效轉場時長；原始 timings 保留於 state / IndexedDB，調整後的 timings 僅在 PPTX 輸出時套用，確保 PPTX 換頁時間點與 MP4 影片在「新頁完全可見」的語意上完全一致。
2. **MP4 xfade offset 公式修正（plan_K）**：xfade offset 改為直接公式 `offset = timings[i].endSec - fadeDur`（不再累加），解決舊版 cumulative offset 在負 offset 頁面後段誤差累積導致影片錯位的問題；每張投影片的 FFmpeg input `-t` 包含自身時長加上所有後續轉場的 carry-in 時間，確保 xfade 不提早截斷。
3. **下載命名時間標籤（plan_L）**：所有可下載檔案（script.txt / lyrics.txt / podcast 音訊 / music.mp3 / podcast.srt / music.srt / podcast.pptx / music.pptx / podcast.mp4 / music.mp4）的實際下載檔名均帶上 `_HHmmss` 本地時間標籤。Podcast 系列以 `scriptGeneratedAt` 為錨點，音樂系列以 `lyricsGeneratedAt` 為錨點（均 fallback 至 `createdAt`）；按鈕文字維持短名稱（如 `podcast.mp4`），方便識別但不影響下載。
4. **`scriptGeneratedAt` / `lyricsGeneratedAt` 新增至 `GenerationRecord`**（`lib/types.ts`）：兩個 `number | undefined` 欄位，分別於 `handleGenerateScript()` / `handleGenerateLyrics()` 設值並存入 IndexedDB；`handleNarrationModeChange()` / `handleNewProject()` 均補入同步清空邏輯，避免舊標籤殘留。
5. **`VideoExportBlock` 新增 `displayName` prop**（`components/VideoExportBlock.tsx`）：按鈕文字改用 `displayName ?? filename`，`filename` 只控制實際下載名稱，UI 與下載行為完全解耦。

### ✨ v11 補充亮點（2026-04-12，部署與維運強化）：
1. **cloudbuild 版本 tag 支援**：`cloudbuild.yaml` 與 `cloudbuild_500.yaml` 均改為同時 build / push / deploy `:latest` 與 `:${_IMAGE_TAG}` 兩個 tag；預設 `_IMAGE_TAG=manual`，可由 CLI `--substitutions` 覆蓋為 `manual-YYYYMMDDHHMI` 格式，方便回溯與回滾。
2. **Cloud Run 最小可用資源明確化**（`cloudbuild.yaml`）：新增 `--cpu=1`、`--concurrency=10`、`--min-instances=0`、`--max-instances=10`；記憶體從 `512Mi` 調整為 `1Gi`（Node.js + LLM 串流安全最低值）；`cloudbuild_500.yaml` 對應調整為 CPU=2 / Memory=4Gi / Concurrency=4 / Min=1，並加入 `--cpu-boost`。
3. **nginx SSL 反向代理**（自架伺服器）：新增 `nginx/default.conf` 與 `docker-compose.yml` nginx service；HTTP 自動 redirect 到 HTTPS；`proxy_buffering off` 確保 LLM streaming 不卡；`client_max_body_size 60M`；`ssl/cert.pem` + `ssl/key.pem` 放專案根目錄即可啟用。
4. **FFmpeg CPU 執行緒限制**（`lib/videoExport.ts`）：新增 `getFFmpegThreads()`，預設 `min(2, cpuCount)`；FFmpeg args 加入 `-threads N` 與 `-filter_threads N`（後者覆蓋 xfade filter graph 執行緒，global `-threads` 管不到）；可由 `VIDEO_FFMPEG_THREADS` env var 覆蓋，`=0` 不限制。
5. **使用量記錄**（`lib/usageLogger.ts`）：新增 `logUsage(email, action)` — 永遠寫 stdout（Cloud Run → Cloud Logging）；`LOG_FILE_PATH` 設定時額外 append JSON Lines 至檔案（Docker volume 持久化）；已接入全部 8 個主要 API route（`parse-pdf` / `generate-script` / `generate-lyrics` / `generate-podcast` / `generate-music` / `align-podcast` / `align-music` / `export-video`）。

### ✨ v10 補充亮點（2026-04-12，plan_J1 + 品質修正）：
1. **Whisper 多語對齊修正（plan_J1）**：`lib/whisper.ts` 新增 `mapContentLanguageToWhisperLanguage()`（`zh-TW→zh / en→en / ja→ja / ko→ko`），並移除原本隱藏的 `|| 'zh'` fallback（改為有值才 append language，否則讓 Whisper auto-detect）；`align-podcast/route.ts` 與 `align-music/route.ts` 接收 `contentLanguage` 並透過 mapping 傳給 Whisper，不再寫死 `'zh'`；`app/page.tsx` Step 4 / Step 7 的 align API request body 補傳 `contentLanguage`，確保多語專案的對齊鏈完整。
2. **`loadRecord()` 殘留狀態修正**：`app/page.tsx` 的 `loadRecord()` 對所有 blob（`pdfFile` / `podcastBlob` / `podcastPptxBlob` / `musicBlob` / `musicPptxBlob`）、step states（Step 1~7）、以及 speaker / voice / dialogueStyle / tone 欄位均補上 `else` 清空邏輯；載入不完整 record 時不再殘留前一個專案的狀態。
3. **`handleNewProject()` 設計意圖明確化**：加入 code comment 說明「保留偏好設定（speaker / voice / style / model）、只清除專案內容」為刻意設計，非 bug。
4. **ESLint 程式碼清理**：移除 `VideoExportBlock.tsx` 未用的 `isLoading`；移除 `lib/prompts.ts` 中未用的 imports（`DEFAULT_SPEAKER1` / `DEFAULT_DIALOGUE_STYLE` / `DEFAULT_TONE`）與廢棄的 `LYRICS_PROMPT_TIMED_OLD` / `LYRICS_PROMPT_TIMED_OLD2`；`lib/srt.ts` 的 `catch (e)` 改為 `catch {}`；`public/pdf.worker.min.mjs` 屬第三方 minified 檔案，不納入 lint 範圍（config-protection hook 保護，不修改 eslint config）。
5. **README 資料修正**：TTS 聲音預設值由錯誤的「Speaker 1 = Zephyr (Male) / Speaker 2 = Puck (Female)」更正為「Speaker 1 = Puck (Male) / Speaker 2 = Zephyr (Female)」（符合 `lib/types.ts` VOICES 定義）；Step 1/4.1/7.1 預設模型更正為 `gemini-2.5-flash`（符合 `DEFAULT_STEP41_MODEL`）。

### ✨ v09 補充亮點（2026-04-12，plan_J）：
1. **`contentLanguage` 多語支援**：新增全專案共用語言設定 `ContentLanguage`（`'zh-TW' | 'en' | 'ja' | 'ko'`），統一控制 Podcast 文稿（Step 2）、歌詞（Step 5）及對應 TTS / 音樂生成（Step 3 / 6）的內容語言。
2. **型別與常數**：`lib/types.ts` 新增 `ContentLanguage` type 與 `GenerationRecord.contentLanguage?`；`lib/constants.ts` 新增 `DEFAULT_CONTENT_LANGUAGE`（`'zh-TW'`）、`CONTENT_LANGUAGE_OPTIONS`（四語選單）、`CONTENT_LANGUAGE_PROMPT_LABEL`（語言代碼 → 英文標示 Map）。
3. **Prompt 語言化**：`lib/prompts.ts` 新增 `buildLanguageBlock(language)` — `zh-TW` 回傳空字串（行為不變）；其他語言產生強硬的【語言指定】區塊，明確禁止模型翻譯 `風格:` / `投影片 N:` / `Speaker 1:` / `Speaker 2:` 等 parser 依賴結構標記，含正反例，防止本地 Gemma 4 LLM 誤翻。`buildNarrationPrompt()` / `buildLyricsPrompt()` 均新增可選 `language?` 參數（預設 `zh-TW`，行為向下相容）。歌詞 prompt 額外加入 K-POP/J-POP 多語混唱例外規則。
4. **Record 流完整覆蓋**：`app/page.tsx` 所有 `updateRecord` 路徑（共 12 處）均帶入 `contentLanguage`——包含 `saveRecord`、Steps 2~7 主流程、兩個音檔 upload handler（Step 3 / 6）、兩個 SRT 偏移重封裝（`handleRepackPodcastPptx` / `handleRepackMusicPptx`）、`handleNarrationModeChange` 模式切換，以及 `loadRecord`（含 `?? DEFAULT_CONTENT_LANGUAGE` fallback）與 `handleNewProject`（重置），確保任意執行路徑後 IndexedDB 均持有最新語言設定，舊紀錄 backfill 徹底完整不 crash。
5. **UI 語言選單**：Step 2 設定區（語氣風格欄位後）新增「內容語言」下拉選單；非 `zh-TW` 時顯示琥珀色提示「非繁體中文建議搭配 Gemini 文字模型使用」。
6. **Audio Route logging**：`generate-podcast` / `generate-music` route 接收並 log `contentLanguage`，方便後續診斷與擴充（如 Lyria wrapper prompt）。
7. **延後項目（J6）**：Step 4 / Step 7 的 alignment prompt 語言化（`align-podcast` / `align-music` route 及前端 API 呼叫需同步修改）列為後續優化，本期不納入，以控制回歸範圍。

### ✨ v08 補充亮點（2026-04-12）：
1. **TTS 分段生成（plan_I / plan_I01）**：新增 `TTS_CHUNKING_ENABLED` feature flag；啟用後，腳本超過 `TTS_CHUNK_CHARS`（預設 800，原 1000，2026-04-14 調降）字元時以投影片邊界自動切段，各段 PCM 串接後插入 800ms（`CHUNK_GAP_MS`）靜音，解決 Gemini TTS 長篇破音問題；duo 與 solo 均套用。新增 `createSilence()`、`trimLeadingSilence()`、`trimTrailingSilence()`、`concatPcmChunks()` 整條 `Uint8Array` PCM 鏈，解決 TypeScript 5.x `Buffer<ArrayBufferLike>` 型別錯誤。
2. **TTS 自動重試**：`callTtsApi()` 對 Gemini TTS 500 系列錯誤最多重試 2 次（間隔 2 秒），4xx 錯誤直接拋出不重試。
3. **`extractSoloScript()` 空白行修正**：solo 模式下 `Speaker 1:` 後無內容的行在 `.map()` 後加 `.filter(Boolean)`，避免空字串被 `join('\n')` 串成空白行送入 TTS，消除非預期停頓。
4. **`calcPodcastTimings()` 比例修正**：改用 `slideTexts.slice(0, slideCount)` 計算 `totalChars`，避免腳本 `投影片` 標記數量多於 PDF 頁數時分母被稀釋，導致所有投影片提前換頁。
5. **前端估時修正**：UI 顯示的估算分鐘數套用 `× 0.8` 校正係數，與實測結果更吻合；`TTS_CHUNKING_ENABLED=true` 時估時自動加入 chunk 間靜音（`chunkCount - 1) × 0.8s`）。
6. **新增 `lib/ttsEstimate.ts`**：`countDialogueChars()`、`estimateTtsDuration()`、`estimateChunkCount()` 三支 UI 估算工具函式，供前端警示提示計算。

### ✨ v04 補充亮點（2026-04-06）：
1. **精準 AI 對齊生成 (Two-step SRT) 與 `startSrtId` 契約統一**：對齊鏈已從舊版直接輸出秒數的 `vocalStartSec`，收斂為 `SRT -> startSrtId -> timings`。Phase 2 的任務是找每張投影片第一次進入時對應的字幕 id，再由程式換算轉場秒數。
2. **Lyria 3 API 解析防呆與模型簡化**：徹底移除了 `30-second` 預設模型，目前全盤統一傳遞給 Lyria 3 Pro 模型。後端解析 response 時採用了「無序物件遍歷」，確保無論 Google API 的 `text` 或 `audio/mp3` 在 `parts` 陣列中的哪個位置全都能安全讀取。
3. **機器解析優先的歌詞格式**：歌詞 prompt 已改為要求 `[段落名稱] [Slide N]`、禁止 AI 自行輸出時間軸、禁止用 `()` / `{}` 寫不可唱提示，並配合新的 slide anchor 摘要產生器。
4. **登入與歷史紀錄隔離**：新增 invitation code + Google OAuth 雙重驗證、`AUTH_ENABLED` 開關、HMAC session token；當 `AUTH_ENABLED=true` 時，IndexedDB 歷史紀錄會依 Google email (`ownerEmail`) 隔離。
5. **簡報收尾、頁數與模型設定補強**：PDF 上傳範圍為 **3-25 張**（後擴充，原 3-15）；Podcast 與 Music 都支援 API 生成與外部上傳兩條路徑；Step 0 已新增模型下拉選單；PPTX 最後一頁不再是 0 秒，而是「原本應有時間 + 2 秒」。

### ✨ v07 補充亮點（2026-04-11）：
1. **資料一致性修正（PPTX / MP4 / SRT / timing 同步）**：`handleRepackPodcastPptx()` / `handleRepackMusicPptx()` 套用偏移後，不只更新 PPTX，還會同步將 offset 烘入 `podcastSrt` / `musicSrt`（使用 `adjustSrtTimes`），更新 `podcastTimings` / `musicTimings` state，清零 offset slider，清除 video blob 快取；IndexedDB 同步寫入 timings 與 SRT；確保 PPTX、MP4、SRT 下載三者永遠一致。
2. **快取失效規則完整化**：`resetPodcastDerivedState()` / `resetMusicDerivedState()` 均補齊 video blob 清除；podcast reset 補上 IndexedDB 清除（與 music 路徑對稱）；`resetMusicDerivedState()` 補齊 `musicTimings` / `musicSrtOffset` 清除；音訊任何來源改變時，PPTX / SRT / timings / video 均一律清空。
3. **VideoExportBlock `onClearCache` prop**：新增 `onClearCache: () => void`，「重新生成」按鈕改為一步完成「清 parent cache → 立即觸發重新生成」；「重試」按鈕改為直接呼叫 `handleGenerate()`，不再需要使用者多按一次主按鈕。
4. **`loadRecord()` SRT offset 歸零**：從歷史紀錄載入專案時，`podcastSrtOffset` / `musicSrtOffset` 一律歸零，避免前一個專案的 offset 值滲入新載入的紀錄。
5. **export-video API body 限制調整**：上限從 50MB 提升至 150MB（依 50MB 音訊 base64 後 ≈67MB + 圖片計算）；`Content-Length` 改為只在 header 存在時才做 pre-flight 檢查；新增 `rawBody` 實際 byte 計數作為真正的安全防線，修復原本 header 缺失就跳過整個檢查的 bypass 問題。

### ✨ v06 補充亮點（2026-04-10）：
1. **MP4 影片匯出**：新增 `app/api/export-video/route.ts` + `lib/videoExport.ts`，FFmpeg xfade 淡入淡出轉場，與 PPTX `<p:fade/>` 視覺一致；並行控制（auto / 手動）；5 分鐘 timeout。
2. **VideoExportBlock 元件**：取代舊的 `VideoExportButton`；session 內只生成一次，後續點擊直接下載快取 blob；503 自動重試（最多 5 次，每次等 10 秒）。
3. **xfade 提早結束修正**：xfade 消耗輸出時間軸的 bug；修正方案：最後一張投影片延長 `sum(fadeDurs) + 2.0s`，移除 `-shortest`，確保影片與音訊對齊並有 2 秒收尾靜止。
4. **Podcast 結尾問題**：`PODCAST_PROMPT_TEMPLATE` 新增結尾規則，最後一頁由主持人拋出開放式問題 + 另一位給語境化回應；使用抽象描述避免字面範例造成 LLM 每次複製同一句話。
5. **多規格 Cloud Run 部署**：新增 `cloudbuild_202.yaml` / `cloudbuild_404.yaml` / `cloudbuild_408.yaml` 三份設定，對應 2Gi / 4Gi / 8Gi 記憶體規格，均預設啟用影片匯出。

### ✨ v05 補充亮點（2026-04-07）：
1. **模型選單收斂為四組**：Step 0 目前改為 `Step 1 / 4.1 / 7.1`、`Step 2 / 4.2 / 5 / 7.2`、`Step 3`、`Step 6` 四組模型下拉，UI 與後端實際能力一致。
2. **Podcast / Music 對齊正式拆為雙階段**：`4.1 / 7.1` 固定負責多模態音訊理解與字幕修正；`4.2 / 7.2` 固定負責 `script/lyrics + SRT` 的文字對齊與 `startSrtId` 推斷。
3. **導入 provider-aware 文字模型選單**：純文字推理步驟現在可同時區分 Google Gemma 與 OpenAI-compatible Gemma，由 `id + provider + model + label` 決定真正走哪條 provider。
4. **Markdown code fence 保留正文**：`stripMarkdown()` 不再把 fenced code block 內文整段刪除，只移除外層 ``` 包裝，避免本地模型輸出被誤清空。
5. **PPTX 音訊 timing XML 補寫**：`generatePptx()` 目前不只嵌入第一頁音訊，還會補寫 `<p:timing>`、`numSld` 與 `spTgt`，讓 PowerPoint 更接近自動播放與跨頁持續播放的行為。

---

## 1. 專案概述

**功能**：使用者上傳 PDF 投影片，系統依序產生：
1. Podcast 對話文稿
2. AI 歌詞
3. Podcast 音訊（WAV）
4. AI 歌曲音訊（MP3）
5. 解析音頻時間產生 Podcast PPTX 簡報（精準對齊轉場）
6. 解析音頻時間產生 Music PPTX 簡報（精準對齊轉場）

**架構**：
- **Frontend**：Next.js App Router，`'use client'` 單頁應用
- **Backend**：Next.js API Routes，兼任 Gemini 代理、Whisper 串接層、auth 驗證端點
- **儲存**：瀏覽器 IndexedDB（含 Blob 儲存），不需後端資料庫；`AUTH_ENABLED=true` 時以 `ownerEmail` 做前端資料隔離
- **BYOK**：使用者自備 Gemini API Key，存於 `sessionStorage`
- **Auth**：可由 `.env.local` 控制是否啟用 Google OAuth + invitation code 雙重驗證

---

## 2. Tech Stack

| 項目 | 版本 |
|------|------|
| Next.js | 16.2.1 |
| React | 19.2.4 |
| TypeScript | ^5 |
| Tailwind CSS | ^4 |
| @google/genai | ^1.46.0 |
| google-auth-library | ^10.6.2 |
| pdfjs-dist | ^5.5.207 |
| pptxgenjs | ^4.0.1 |
| jszip | ^3.10.1 |
| idb | ^8.0.3 |
| lamejs | ^1.2.1 ← 安裝但不使用，改用自訂 pcmToWav |

---

## 3. 初始化指令

```bash
npx create-next-app@16.2.1 pocast2 --typescript --tailwind --app --no-src-dir --no-import-alias
cd pocast2

npm install @google/genai google-auth-library idb jszip pptxgenjs pdfjs-dist lamejs
npm install --save-dev @types/node

# 複製 pdfjs worker 到 public/
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/
```

---

## 4. 啟動開發伺服器

```bash
# ⚠️ 必須加 --webpack，不能用 Turbopack
# Windows 上 Turbopack 會崩潰 (exit code 0xc0000142)
npm run dev -- --port 4000 --webpack
```

---

## 5. next.config.ts

```typescript
import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  webpack: (config, { isServer, webpack }) => {
    const emptyModule = path.resolve('./lib/empty-module.js');

    // 兩端都需要：將 node: 前綴剝除，讓 webpack 能解析內建模組
    // pptxgenjs、pdfjs-dist 等套件使用 node:fs、node:url 等寫法
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
        resource.request = resource.request.replace(/^node:/, '');
      })
    );

    if (!isServer) {
      // Client side：將 Node.js 專用模組映射為空物件
      // ⚠️ 必須用 emptyModule（module.exports = {}），不能用 false
      // false 會使 Object.defineProperty 失敗（pdfjs 等套件會呼叫它）
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: emptyModule,
        https: emptyModule,
        http: emptyModule,
        net: emptyModule,
        tls: emptyModule,
        child_process: emptyModule,
        os: emptyModule,
        worker_threads: emptyModule,
        zlib: emptyModule,
      };
      config.resolve.alias = { ...config.resolve.alias, canvas: false };
    }
    return config;
  },
};

export default nextConfig;
```

---

## 6. lib/empty-module.js

```js
module.exports = {};
```

---

## 7. 檔案結構

```
pocast2/
├── app/
│   ├── layout.tsx
│   ├── page.tsx           ← 主應用（~900 行）
│   ├── globals.css
│   └── api/
│       ├── auth/
│       │   ├── google/route.ts
│       │   └── login/route.ts
│       ├── parse-pdf/route.ts
│       ├── generate-script/route.ts
│       ├── generate-lyrics/route.ts
│       ├── generate-podcast/route.ts
│       ├── generate-music/route.ts
│       ├── align-podcast/route.ts
│       ├── align-music/route.ts
│       ├── export-video/route.ts  ← MP4 影片匯出（需 VIDEO_EXPORT_ENABLED=true）
│       └── runtime-config/route.ts
├── components/
│   ├── LoginPage.tsx       ← auth 啟用時的登入頁
│   └── VideoExportBlock.tsx ← 影片匯出卡片元件（含 session 快取與 503 自動重試）
├── instrumentation.ts      ← Next.js server startup hook，清理 /tmp/video-export 殘留
├── lib/
│   ├── constants.ts        ← 所有常數、上傳規則與 API key/session key 常數
│   ├── types.ts            ← TypeScript 型別
│   ├── auth.ts             ← server-side auth, token, rate limit, Google verify
│   ├── authClient.ts       ← client-side auth session 存取
│   ├── getAI.ts            ← Gemini 初始化（server side）+ session 驗證
│   ├── apiFetch.ts         ← fetch 封裝（client side），同時帶 API key 與 auth token
│   ├── prompts.ts          ← 提示詞建構函式（PODCAST_PROMPT_TEMPLATE 含結尾規則）
│   ├── stripMarkdown.ts    ← 移除 Markdown 標記
│   ├── db.ts               ← IndexedDB CRUD + owner 驗證
│   ├── timing.ts           ← 音訊時間計算與 fallback
│   ├── srt.ts              ← SRT 解析、修補、格式化
│   ├── whisper.ts          ← Whisper API 串接
│   ├── generatePptx.ts     ← PPTX 生成（client side）
│   ├── pdfToImages.ts      ← PDF 轉圖（pdfToJpegBase64 供影片匯出用）
│   ├── videoExport.ts      ← FFmpeg 影片合成（xfade / concat）
│   └── empty-module.js     ← webpack fallback
└── public/
    └── pdf.worker.min.mjs  ← 從 pdfjs-dist 複製
```

---

## 8. Gemini API 使用方式

### 8.1 初始化

```typescript
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'YOUR_KEY' });
```

### 8.2 模型清單

```
Step 1 / 4.1 / 7.1     → gemini-3.1-pro-preview / gemini-3-flash-preview（預設） / gemini-2.5-flash
Step 2 / 4.2 / 5 / 7.2 → 預設為 gemini-3-flash-preview；當 LOCAL_LLM_* 已完整設定時，會額外出現 Gemma 4，並自動成為預設（實際模型名稱 gemma-4-31B-it）
Step 3                 → gemini-2.5-pro-preview-tts / gemini-2.5-flash-preview-tts（預設）
Step 6                 → lyria-3-pro-preview（預設）
Whisper（若啟用）      → whisper-Breeze-ASR-25
Local LLM（若啟用）    → OpenAI-compatible `/chat/completions`
```

### 8.3 文字生成（PDF 解析、文稿、歌詞）

```typescript
const response = await ai.models.generateContent({
  model: 'gemini-3-flash-preview',
  contents: [{
    parts: [
      { text: prompt },
      // PDF 解析時附加 PDF 資料
      { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
    ],
  }],
});
const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
```

### 8.4 多人 TTS（Podcast 音訊）

```typescript
// ⚠️ 送入 script 前必須預處理：
// 1. 只保留 "風格：" 與 "Speaker N:" 開頭的行
// 2. 去除括號名稱：Speaker 1 (阿哲): → Speaker 1:
// 3. speaker 欄位名稱必須與 script 完全一致

const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash-preview-tts',
  contents: [{ parts: [{ text: dialogue }] }],
  config: {
    responseModalities: ['AUDIO'],
    speechConfig: {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          { speaker: 'Speaker 1', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          { speaker: 'Speaker 2', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
        ],
      },
    },
  },
});

// 回傳格式：PCM 16-bit Little-Endian，需自行加 WAV header
const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data; // base64
const mimeType = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType;
// mimeType 範例：'audio/L16;rate=24000'
```

### 8.5 AI 音樂生成（Lyria）

```typescript
const response = await ai.models.generateContent({
  model: 'lyria-3-pro-preview',
  contents: [{ parts: [{ text: lyrics }] }],
  config: { responseModalities: ['AUDIO', 'TEXT'] },
});
// 遍歷 parts 找 inlineData，mimeType 為 'audio/mpeg'
for (const part of response.candidates?.[0]?.content?.parts ?? []) {
  if (part.inlineData?.data) {
    audioBase64 = part.inlineData.data;
    audioMimeType = part.inlineData.mimeType ?? 'audio/mpeg';
    break;
  }
}
```

---

## 9. API Key 安全傳遞

前端不直接暴露 API Key，使用 XOR + Base64 編碼後放在 Header。

```typescript
// lib/constants.ts
const API_KEY_SEED = 'pcast-gen-2024';

function xorWithSeed(str: string, seed: string): string {
  return Array.from(str)
    .map((ch, i) => String.fromCharCode(ch.charCodeAt(0) ^ seed.charCodeAt(i % seed.length)))
    .join('');
}

export function encodeApiKey(raw: string): string {
  return btoa(xorWithSeed(raw, API_KEY_SEED));
}
export function decodeApiKey(encoded: string): string {
  return xorWithSeed(atob(encoded), API_KEY_SEED);
}
```

```typescript
// lib/apiFetch.ts — 前端發 request
headers: { 'X-Gemini-Key': encodeApiKey(apiKey) }

// lib/getAI.ts — 後端解碼
const encoded = req.headers.get('X-Gemini-Key');
const apiKey = decodeApiKey(encoded);
```

---

## 9.1 可開關的登入機制

系統新增一層可由 `.env.local` 控制的 auth：

```env
AUTH_ENABLED=true|false
NEXT_PUBLIC_AUTH_ENABLED=true|false
INVITATION_CODE=ai4all
SESSION_SECRET=...
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
NEXT_PUBLIC_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
```

規則如下：
- `AUTH_ENABLED=false`：不啟用登入頁，系統維持原本 BYOK 模式
- `AUTH_ENABLED=true`：必須先通過 invitation code + Google ID token 驗證，前端才會進入主工作台
- API 呼叫時同時帶：
  - `X-Gemini-Key`：BYOK API key
  - `Authorization: Bearer <session token>`：登入後取得的 session token

`/api/auth/google` 的流程：
1. 驗證 invitation code
2. 用 `google-auth-library` 驗證 Google ID token
3. 以 `SESSION_SECRET` 產生 24 小時有效的 HMAC session token
4. 回傳 `{ token, email }`

登入頁由 `components/LoginPage.tsx` 提供，使用 Google Identity Services 前端按鈕，不需要 client secret。

---

## 9.2 本地 OpenAI-compatible LLM 設定

純文字推理步驟（`Step 2 / 4.2 / 5 / 7.2`）可改接本地或私有部署的 OpenAI-compatible Chat Completions API。

```env
LOCAL_LLM_BASE_URL=http://127.0.0.1:8000/v1/chat/completions
LOCAL_LLM_API_KEY=replace-with-your-local-llm-key
LOCAL_LLM_MODEL=gemma-4-31B-it
LOCAL_LLM_LABEL=Gemma 4 31B (Custom)
```

規則如下：
- 若 `LOCAL_LLM_BASE_URL` 已是 `/chat/completions` 完整端點，程式直接使用。
- 若 `LOCAL_LLM_BASE_URL` 只填到 `/v1`，程式會自動補上 `/chat/completions`。
- `generateText()` 會先判斷模型是否為 Gemini；若不是，則改走 OpenAI-compatible 路徑。
- 若設定了 `LOCAL_LLM_MODEL`，本地路徑實際送出的 `model` 會優先使用此值。
- `LOCAL_LLM_LABEL` 只影響 UI 顯示名稱，方便將同一個模型 id 包裝成較友善的名稱，例如 `Gemma 4 31B (Custom)`、`Qwen 32B`。

---

## 10. lib/constants.ts（完整）

```typescript
export const API_KEY_HEADER = 'X-Gemini-Key';
export const API_KEY_SEED   = 'pcast-gen-2024';
export const SESSION_KEY    = 'gemini_key';

export const TEXT_MODEL_OPTIONS = [
  { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview' },
  { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
  { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
] as const;

export const TTS_MODEL_OPTIONS = [
  { value: 'gemini-2.5-pro-preview-tts', label: 'gemini-2.5-pro-preview-tts' },
  { value: 'gemini-2.5-flash-preview-tts', label: 'gemini-2.5-flash-preview-tts（預設）' },
] as const;

export const MUSIC_MODEL_OPTIONS = [
  { value: 'lyria-3-pro-preview', label: 'lyria-3-pro-preview（預設）' },
] as const;

export const DEFAULT_TEXT_MODEL  = 'custom-gemma-4-31b';
export const DEFAULT_TTS_MODEL   = 'gemini-2.5-flash-preview-tts';
export const DEFAULT_MUSIC_MODEL = 'lyria-3-pro-preview';

export const DEFAULT_SPEAKER1        = '男生為節目主持人';
export const DEFAULT_SPEAKER2        = '女生為高師大的老師 Mary 老師（具教學經驗，說明清楚）';
export const DEFAULT_DIALOGUE_STYLE  = '採自然流暢的對話形式，具有節目感與互動感';
export const DEFAULT_TONE            = '語氣親切、易懂，適合一般聽眾';
export const DEFAULT_VOICE1          = 'Zephyr';
export const DEFAULT_VOICE2          = 'Puck';
export const DEFAULT_STYLE_ID        = 1;
export const DEFAULT_LYRICS_DURATION = '105';

export const LYRICS_DURATIONS = [
  { label: 'Short（精華版）– 60s', value: '60' },
  { label: 'Standard（主打歌 ⭐）– 105s', value: '105' },
  { label: 'Full（完整版）– 135s', value: '135' },
  { label: 'Pro（演唱會版）– 180s', value: '180' }
] as const;

export const voiceSampleUrl = (name: string) =>
  `https://www.gstatic.com/aistudio/voices/samples/${name}.wav`;

export const PARSE_PDF_PROMPT =
  '請將以下每頁投影片圖片內容整理成結構化文字，格式：\n' +
  '投影片 1: [內容]\n投影片 2: [內容]\n' +
  '以此類推，每張投影片的內容要完整詳細。純文字輸出，不使用任何 Markdown 符號。';

export const PODCAST_PROMPT_TEMPLATE = (vars: {
  speaker1: string; speaker2: string; dialogueStyle: string; tone: string;
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

export const LYRICS_PROMPT_TIMED = (styleLabel: string, totalSec: number, endTime: string) =>
  `幫我創作 ${styleLabel} 風格歌詞，長度約 ${totalSec} 秒，並依照以下投影片內容順序編寫歌詞。`;

function xorWithSeed(str: string, seed: string): string {
  return Array.from(str)
    .map((ch, i) => String.fromCharCode(ch.charCodeAt(0) ^ seed.charCodeAt(i % seed.length)))
    .join('');
}
export function encodeApiKey(raw: string): string { return btoa(xorWithSeed(raw, API_KEY_SEED)); }
export function decodeApiKey(encoded: string): string { return xorWithSeed(atob(encoded), API_KEY_SEED); }
```

---

## 11. lib/types.ts（完整）

```typescript
export interface SlideTiming {
  slideIndex: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}
export type SlideTimings = SlideTiming[];

export interface GenerationRecord {
  id: string;
  pdfName: string;
  createdAt: number;
  speaker1?: string;
  speaker2?: string;
  dialogueStyle?: string;
  tone?: string;
  voice1?: string;
  voice2?: string;
  styleId?: number;
  lyricsDuration?: string;
  musicStyle: string;
  slides?: string;
  script?: string;
  lyrics?: string;
  pdfBlob?: Blob;
  podcastBlob?: Blob;
  musicBlob?: Blob;
  podcastPptxBlob?: Blob;
  musicPptxBlob?: Blob;
}

export interface StepState {
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
}

export const MUSIC_STYLES = [
  { id: 1,  label: 'K-POP Dance Pop' },
  { id: 2,  label: 'C-POP 國風電子' },
  { id: 3,  label: '台灣抒情流行' },
  { id: 4,  label: 'J-POP / City Pop' },
  { id: 5,  label: 'EDM / Synth-Pop' },
  { id: 6,  label: 'Hip-Hop / Trap' },
  { id: 7,  label: 'R&B / Neo Soul' },
  { id: 8,  label: 'Pop Rock' },
  { id: 9,  label: 'Indie Folk' },
  { id: 10, label: '歌劇 / Musical Theater' },
  { id: 11, label: 'Reggaeton' },
  { id: 12, label: 'Jazz / Swing' },
  { id: 13, label: 'Disco Funk' },
  { id: 14, label: 'Cinematic / Epic Orchestra' },
] as const;

export const VOICES = [
  { name: 'Zephyr',        desc: 'Bright, Higher pitch, Female' },
  { name: 'Puck',          desc: 'Upbeat, Middle pitch, Male' },
  { name: 'Charon',        desc: 'Informative, Lower pitch, Male' },
  { name: 'Kore',          desc: 'Firm, Middle pitch, Female' },
  { name: 'Fenrir',        desc: 'Excitable, Lower middle pitch, Male' },
  { name: 'Leda',          desc: 'Youthful, Higher pitch, Female' },
  { name: 'Orus',          desc: 'Firm, Lower middle pitch, Male' },
  { name: 'Aoede',         desc: 'Breezy, Middle pitch, Female' },
  { name: 'Callirrhoe',    desc: 'Easy-going, Middle pitch, Female' },
  { name: 'Autonoe',       desc: 'Bright, Middle pitch, Female' },
  { name: 'Enceladus',     desc: 'Breathy, Lower pitch, Male' },
  { name: 'Iapetus',       desc: 'Clear, Lower middle pitch, Male' },
  { name: 'Umbriel',       desc: 'Easy-going, Lower middle pitch, Male' },
  { name: 'Algieba',       desc: 'Smooth, Lower pitch, Male' },
  { name: 'Despina',       desc: 'Smooth, Middle pitch, Female' },
  { name: 'Erinome',       desc: 'Clear, Middle pitch, Female' },
  { name: 'Algenib',       desc: 'Gravelly, Lower pitch, Male' },
  { name: 'Rasalgethi',    desc: 'Informative, Middle pitch, Male' },
  { name: 'Laomedeia',     desc: 'Upbeat, Higher pitch, Female' },
  { name: 'Achernar',      desc: 'Soft, Higher pitch, Female' },
  { name: 'Alnilam',       desc: 'Firm, Lower middle pitch, Male' },
  { name: 'Schedar',       desc: 'Even, Lower middle pitch, Male' },
  { name: 'Gacrux',        desc: 'Mature, Middle pitch, Female' },
  { name: 'Pulcherrima',   desc: 'Forward, Middle pitch, Female' },
  { name: 'Achird',        desc: 'Friendly, Lower middle pitch, Male' },
  { name: 'Zubenelgenubi', desc: 'Casual, Lower middle pitch, Male' },
  { name: 'Vindemiatrix',  desc: 'Gentle, Middle pitch, Female' },
  { name: 'Sadachbia',     desc: 'Lively, Lower pitch, Male' },
  { name: 'Sadaltager',    desc: 'Knowledgeable, Middle pitch, Male' },
  { name: 'Sulafat',       desc: 'Warm, Middle pitch, Female' },
] as const;
```

---

## 12. lib/getAI.ts

```typescript
import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_HEADER, decodeApiKey } from './constants';

export function getAI(req: NextRequest) {
  const encoded = req.headers.get(API_KEY_HEADER);
  if (!encoded) throw new Error('Missing API Key');
  const apiKey = decodeApiKey(encoded);
  return new GoogleGenAI({ apiKey });
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Missing or invalid API Key' }, { status: 401 });
}
```

---

## 13. lib/apiFetch.ts

```typescript
import { API_KEY_HEADER, SESSION_KEY, encodeApiKey } from './constants';

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function apiFetch(path: string, body: object): Promise<Response> {
  const raw = sessionStorage.getItem(SESSION_KEY) ?? '';
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [API_KEY_HEADER]: raw ? encodeApiKey(raw) : '',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    sessionStorage.removeItem(SESSION_KEY);
    onUnauthorized?.();
    throw new Error('Invalid or missing API Key');
  }
  return res;
}
```

---

## 14. lib/prompts.ts

```typescript
import { PODCAST_PROMPT_TEMPLATE, LYRICS_PROMPT_TIMED } from './constants';

export function buildPodcastPrompt(vars: {
  speaker1: string; speaker2: string; dialogueStyle: string; tone: string;
}) {
  return PODCAST_PROMPT_TEMPLATE(vars);
}

export function buildLyricsPrompt(styleLabel: string, duration: string): string {
  const parsedSec = parseInt(duration, 10);
  const totalSec = isNaN(parsedSec) ? 90 : parsedSec; 
  
  const mm = Math.floor(totalSec / 60);
  const ss = String(totalSec % 60).padStart(2, '0');
  const endTime = \`\${mm}:\${ss}\`;
  
  return LYRICS_PROMPT_TIMED(styleLabel, totalSec, endTime);
}
```

---

## 15. lib/stripMarkdown.ts

```typescript
export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`{3}[\s\S]*?`{3}/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

---

## 16. lib/db.ts

```typescript
import { openDB, IDBPDatabase } from 'idb';
import type { GenerationRecord } from './types';

const DB_NAME = 'podcast-generator';
const DB_VERSION = 1;
const STORE_NAME = 'records';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveRecord(record: GenerationRecord) {
  const db = await getDB();
  await db.put(STORE_NAME, record);
}

export async function getRecord(id: string): Promise<GenerationRecord | undefined> {
  const db = await getDB();
  return db.get(STORE_NAME, id);
}

export async function getAllRecords(): Promise<GenerationRecord[]> {
  const db = await getDB();
  const all = await db.getAll(STORE_NAME);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteRecord(id: string) {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

export async function updateRecord(id: string, updates: Partial<GenerationRecord>) {
  const db = await getDB();
  const existing = await db.get(STORE_NAME, id);
  if (existing) {
    await db.put(STORE_NAME, { ...existing, ...updates });
  }
}
```

---

## 17. lib/timing.ts

```typescript
import type { SlideTimings } from './types';

export function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(audio.duration); };
    audio.onerror = reject;
    audio.src = url;
  });
}

export async function calcPodcastTimings(script: string, slideCount: number, podcastBlob: Blob): Promise<SlideTimings> {
  const totalDuration = await getAudioDuration(podcastBlob);
  const matches = [...script.matchAll(/投影片\s*(\d+)[：:]/g)];
  if (matches.length === 0) return equalDistribution(slideCount, totalDuration);

  const slideTexts: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : script.length;
    slideTexts.push(script.slice(start, end));
  }
  const totalChars = slideTexts.reduce((s, t) => s + t.length, 0);
  const timings: SlideTimings = [];
  let currentSec = 0;
  for (let i = 0; i < slideCount; i++) {
    const ratio = totalChars > 0 ? (slideTexts[i]?.length ?? 0) / totalChars : 1 / slideCount;
    const duration = totalDuration * ratio;
    timings.push({ slideIndex: i + 1, startSec: currentSec, endSec: currentSec + duration, durationSec: duration });
    currentSec += duration;
  }
  return timings;
}

export async function calcMusicTimings(slideCount: number, musicBlob: Blob, lyrics?: string): Promise<SlideTimings> {
  const totalDuration = await getAudioDuration(musicBlob);
  if (lyrics) {
    const parsed = parseLyricsTimings(lyrics, slideCount, totalDuration);
    if (parsed.length > 0) return parsed;
  }
  return equalDistribution(slideCount, totalDuration);
}

export function parseLyricsTimings(lyrics: string, slideCount: number, totalDuration: number): SlideTimings {
  const timestampRegex = /\[(\d+\.?\d*):\]/g;
  const timestamps: number[] = [];
  let match;
  while ((match = timestampRegex.exec(lyrics)) !== null) {
    const sec = parseFloat(match[1]);
    if (timestamps.length === 0 || sec !== timestamps[timestamps.length - 1]) timestamps.push(sec);
  }
  if (timestamps.length === 0) return [];
  const timings: SlideTimings = [];
  const perSlide = Math.max(1, Math.floor(timestamps.length / slideCount));
  for (let i = 0; i < slideCount; i++) {
    const tsIdx = i * perSlide;
    const startSec = timestamps[tsIdx] ?? timestamps[timestamps.length - 1];
    const nextIdx = (i + 1) * perSlide;
    const endSec = nextIdx < timestamps.length ? timestamps[nextIdx] : totalDuration;
    timings.push({ slideIndex: i + 1, startSec, endSec, durationSec: Math.max(endSec - startSec, 1) });
  }
  return timings;
}

function equalDistribution(slideCount: number, totalDuration: number): SlideTimings {
  const perSlide = totalDuration / slideCount;
  return Array.from({ length: slideCount }, (_, i) => ({
    slideIndex: i + 1,
    startSec: i * perSlide,
    endSec: (i + 1) * perSlide,
    durationSec: perSlide,
  }));
}

export function extractSlideTexts(text: string, slideCount: number): string[] {
  const matches = [...text.matchAll(/投影片\s*\d+[：:]/g)];
  if (matches.length > 0) {
    return matches.map((m, i) => {
      const start = m.index! + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
      return text.slice(start, end).trim();
    });
  }
  const lines = text.split('\n').filter(l => l.trim());
  const perSlide = Math.ceil(lines.length / slideCount);
  return Array.from({ length: slideCount }, (_, i) =>
    lines.slice(i * perSlide, (i + 1) * perSlide).join('\n')
  );
}
```

---

## 18. lib/generatePptx.ts

```typescript
import type { SlideTimings } from './types';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ⚠️ 關鍵：pdfjs-dist v5 不能用 webpack bundle
// 必須用 webpackIgnore + CDN URL，在執行期由瀏覽器直接載入
// 若用 import('pdfjs-dist')，webpack 打包後會出現 Object.defineProperty called on non-object
export async function generatePptx(
  pdfBlob: Blob,
  timings: SlideTimings,
  audioBlob?: Blob
): Promise<Blob> {
  // @ts-ignore: bypass remote https import typing
  const pdfjsLib = await import(/* webpackIgnore: true */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.worker.min.mjs';

  const PptxGenJS = (await import('pptxgenjs')).default;
  const JSZip = (await import('jszip')).default;

  const arrayBuffer = await pdfBlob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';

  const audioBase64 = audioBlob ? await blobToBase64(audioBlob) : null;
  const audioMime = audioBlob?.type || 'audio/wav';
  const audioExtn = audioMime.includes('mpeg') || audioMime.includes('mp3') ? 'mp3' : 'wav';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not available');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const imgBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

    const slide = pptx.addSlide();
    slide.addImage({ data: `image/jpeg;base64,${imgBase64}`, x: 0, y: 0, w: '100%', h: '100%' });

    // 嵌入音訊至第一頁左上角
    if (i === 1 && audioBase64) {
      slide.addMedia({
        type: 'audio',
        extn: audioExtn,
        data: `audio/${audioExtn};base64,${audioBase64}`,
        x: 0.1, y: 0.1, w: 0.8, h: 0.8,
      });
    }
  }

  const pptxBuffer = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer;
  const zip = await JSZip.loadAsync(pptxBuffer);

  // 設定每頁自動換頁計時
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/slide(\d+)\.xml/)![1]) - parseInt(b.match(/slide(\d+)\.xml/)![1]));

  for (let i = 0; i < slideFiles.length; i++) {
    let xml = await zip.file(slideFiles[i])?.async('string');
    if (!xml) continue;
    const durationMs = Math.max(Math.round((timings[i]?.durationSec ?? 5) * 1000), 1000);
    
    const isLastSlide = i === slideFiles.length - 1;
    const finalDurationMs = isLastSlide ? durationMs + 2000 : durationMs;
    const effectXML = '<p:fade/>';
    
    xml = xml.replace('</p:sld>', `<p:transition spd="med" advClick="1" advTm="${finalDurationMs}">${effectXML}</p:transition></p:sld>`);
    zip.file(slideFiles[i], xml);
  }

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
```

---

## 19. API Routes

### app/api/parse-pdf/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { stripMarkdown } from '@/lib/stripMarkdown';
import { resolveTextModel } from '@/lib/constants';
import { PARSE_PDF_PROMPT } from '@/lib/prompts';

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { pdf, textModel } = await req.json() as { pdf: string; textModel?: string };
    const modelName = resolveTextModel(textModel);
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ parts: [{ text: PARSE_PDF_PROMPT }, { inlineData: { mimeType: 'application/pdf', data: pdf } }] }],
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return NextResponse.json({ slides: stripMarkdown(raw) });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Missing API Key') return unauthorizedResponse();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

### app/api/generate-script/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { buildPodcastPrompt } from '@/lib/prompts';
import { stripMarkdown } from '@/lib/stripMarkdown';
import { resolveTextModel } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { slides, speaker1, speaker2, dialogueStyle, tone, textModel } = await req.json();
    const modelName = resolveTextModel(textModel);
    const prompt = buildPodcastPrompt({ speaker1, speaker2, dialogueStyle, tone });
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ parts: [{ text: `${prompt}\n\n${slides}` }] }],
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return NextResponse.json({ script: stripMarkdown(raw) });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Missing API Key') return unauthorizedResponse();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

### app/api/generate-lyrics/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { buildLyricsPrompt } from '@/lib/prompts';
import { MUSIC_STYLES } from '@/lib/types';
import { stripMarkdown } from '@/lib/stripMarkdown';
import { DEFAULT_LYRICS_DURATION, resolveTextModel } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { script, styleId, duration = DEFAULT_LYRICS_DURATION, textModel } = await req.json();
    const modelName = resolveTextModel(textModel);
    const styleLabel = MUSIC_STYLES.find(s => s.id === styleId)?.label ?? MUSIC_STYLES[0].label;
    const prompt = buildLyricsPrompt(styleLabel, duration);
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ parts: [{ text: `${prompt}\n\n${script}` }] }],
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return NextResponse.json({ lyrics: stripMarkdown(raw) });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Missing API Key') return unauthorizedResponse();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

### app/api/generate-podcast/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { DEFAULT_VOICE1, DEFAULT_VOICE2, resolveTtsModel } from '@/lib/constants';

export const maxDuration = 300;

// PCM 16-bit mono → WAV（不需要額外套件）
function pcmToWav(pcmData: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1, bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer).set(pcmData, 44);
  return new Uint8Array(buffer);
}

// ⚠️ 送給 TTS 前必須預處理 script：
// 1. 只保留 "風格：" 與 "Speaker N:" 開頭的行
// 2. 去除括號名稱，如 Speaker 1 (阿哲): → Speaker 1:
// 3. 換行用單行 \n（不要 \n\n）
// 原因：TTS speaker 名稱必須與 speakerVoiceConfigs[].speaker 完全一致
function extractDialogue(script: string): string {
  return script
    .split('\n')
    .filter(line => {
      const t = line.trim();
      return /^風格[：:]/.test(t) || /^Speaker\s+\d+/i.test(t);
    })
    .map(line => line.replace(/^(Speaker\s+\d+)\s*\([^)]*\)\s*:/i, '$1:'))
    .join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { script, voice1 = DEFAULT_VOICE1, voice2 = DEFAULT_VOICE2, ttsModel } = await req.json();
    const modelName = resolveTtsModel(ttsModel);
    const dialogue = extractDialogue(script);
    if (!dialogue) return NextResponse.json({ error: 'No dialogue lines found in script' }, { status: 400 });

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ parts: [{ text: dialogue }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              { speaker: 'Speaker 1', voiceConfig: { prebuiltVoiceConfig: { voiceName: voice1 } } },
              { speaker: 'Speaker 2', voiceConfig: { prebuiltVoiceConfig: { voiceName: voice2 } } },
            ],
          },
        },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    if (!audioData) return NextResponse.json({ error: 'No audio data returned' }, { status: 502 });

    const mimeType = part?.inlineData?.mimeType ?? 'audio/L16;rate=24000';
    const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)?.[1] ?? '24000');

    const pcmData = Buffer.from(audioData, 'base64');
    const wavData = pcmToWav(new Uint8Array(pcmData), sampleRate);

    // ⚠️ 必須明確轉型 wavData as any，否則 Cloud Run 中的 Next.js 嚴格編譯期會報錯
    return new NextResponse(wavData as any, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wavData.byteLength),  // ⚠️ 必須加，否則瀏覽器 Failed to fetch
        'Content-Disposition': 'attachment; filename="podcast.wav"',
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Missing API Key') return unauthorizedResponse();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

### app/api/generate-music/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { getMusicModel } from '@/lib/constants';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { lyrics, duration, musicModel } = await req.json();
    const response = await ai.models.generateContent({
      model: getMusicModel(duration ?? '90-second', musicModel),
      contents: [{ parts: [{ text: lyrics }] }],
      config: { responseModalities: ['AUDIO', 'TEXT'] },
    });

    let audioBase64: string | null = null;
    let audioMimeType = 'audio/mpeg';
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        audioBase64 = part.inlineData.data;
        audioMimeType = part.inlineData.mimeType ?? 'audio/mpeg';
        break;
      }
    }

    if (!audioBase64) {
      const feedback = (response as unknown as Record<string, unknown>).promptFeedback as Record<string, unknown> | undefined;
      const blockReason = feedback?.blockReason;
      return NextResponse.json(
        { error: blockReason === 'PROHIBITED_CONTENT' ? 'PROHIBITED_CONTENT' : 'Music generation returned no audio data' },
        { status: 502 }
      );
    }

    const audioData = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
    return new NextResponse(audioData, {
      headers: { 'Content-Type': audioMimeType },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Missing API Key') return unauthorizedResponse();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

---

## 20. app/layout.tsx

```typescript
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Podcast & Music Generator',
  description: 'AI 驅動的 Podcast 與音樂生成工具',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
```

---

## 21. app/page.tsx 架構說明

`page.tsx` 是一個 `'use client'` 單頁應用，約 900 行。以下說明關鍵設計，實作時請依此建構。

### 21.1 State 定義

```typescript
// Step 0 設定
const [speaker1, setSpeaker1] = useState(DEFAULT_SPEAKER1);
const [speaker2, setSpeaker2] = useState(DEFAULT_SPEAKER2);
const [dialogueStyle, setDialogueStyle] = useState(DEFAULT_DIALOGUE_STYLE);
const [tone, setTone] = useState(DEFAULT_TONE);
const [voice1, setVoice1] = useState<string>(DEFAULT_VOICE1);
const [voice2, setVoice2] = useState<string>(DEFAULT_VOICE2);
const [multimodalModel, setMultimodalModel] = useState<string>(DEFAULT_MULTIMODAL_MODEL);
const [textModel, setTextModel] = useState<string>(DEFAULT_TEXT_MODEL);
const [ttsModel, setTtsModel] = useState<string>(DEFAULT_TTS_MODEL);
const [musicModel, setMusicModel] = useState<string>(DEFAULT_MUSIC_MODEL);
const [styleId, setStyleId] = useState(DEFAULT_STYLE_ID);
const [lyricsDuration, setLyricsDuration] = useState(DEFAULT_LYRICS_DURATION);

// API Key
const [apiKey, setApiKey] = useState('');
const [apiKeyInput, setApiKeyInput] = useState('');

// 資料
const [pdfFile, setPdfFile] = useState<File | null>(null);
const [slides, setSlides] = useState('');
const [script, setScript] = useState('');
const [lyrics, setLyrics] = useState('');
const [podcastBlob, setPodcastBlob] = useState<Blob | null>(null);
const [musicBlob, setMusicBlob] = useState<Blob | null>(null);
const [podcastPptxBlob, setPodcastPptxBlob] = useState<Blob | null>(null);
const [musicPptxBlob, setMusicPptxBlob] = useState<Blob | null>(null);

// 步驟狀態
const [step1State, setStep1State] = useState<StepState>({ status: 'idle' });
// step2State ~ step5State 同上

// IndexedDB
const [recordId, setRecordId] = useState('');
const [history, setHistory] = useState<GenerationRecord[]>([]);
const [drawerOpen, setDrawerOpen] = useState(false);

// UI
const [toast, setToast] = useState('');
const [pptxLoading, setPptxLoading] = useState(false);
const [dragging, setDragging] = useState(false);
```

### 21.2 useEffect 初始化

```typescript
useEffect(() => {
  // 從 sessionStorage 讀取 API Key
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved) setApiKey(saved);
  setUnauthorizedHandler(() => { setApiKey(''); });
  loadHistory();
}, []);
```

### 21.3 Step 1 — PDF 上傳

```typescript
async function handlePdfUpload(file: File) {
  if (!apiKey) { setToast('請先填入 Gemini API Key'); return; }

  // 1. 檢查檔案格式
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    const msg = '上傳檔案必須為 pdf';
    setStep1State({ status: 'error', error: msg });
    setToast(msg);
    return;
  }

  setPdfFile(file);
  setStep1State({ status: 'loading' });
  try {
    // 2. 檢查 PDF 頁數限制 (用 CDN版 pdfjs-dist 解析)
    const pdfjsLib = await import(/* webpackIgnore: true */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.worker.min.mjs';
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    if (pdfDoc.numPages < 3 || pdfDoc.numPages > 15) {
      const msg = '請上傳 3-15 頁的範圍簡報檔案';
      setStep1State({ status: 'error', error: msg });
      setToast(msg);
      return;
    }

    // ⚠️ 必須用 FileReader.readAsDataURL，不能用 String.fromCharCode(...new Uint8Array(buf))
    // 後者對大型 PDF 會觸發 RangeError: Maximum call stack size exceeded
    const pdfBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const res = await apiFetch('/api/parse-pdf', { pdf: pdfBase64 });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    setSlides(data.slides);
    setStep1State({ status: 'done' });

    // 建立 IndexedDB 紀錄
    const id = `${Date.now()}`;
    setRecordId(id);
    await saveRecord({
      id, pdfName: file.name, createdAt: Date.now(),
      speaker1, speaker2, dialogueStyle, tone, voice1, voice2, styleId, lyricsDuration,
      musicStyle: MUSIC_STYLES.find(s => s.id === styleId)?.label ?? '',
      slides: data.slides,
      pdfBlob: file,  // 直接存 File（繼承 Blob），還原時可用 new File([rec.pdfBlob], rec.pdfName)
    });
    loadHistory();
  } catch (e) {
    setStep1State({ status: 'error', error: String(e) });
  }
}
```

### 21.4 Step 2-5 生成流程

每個步驟模式相同：
1. 呼叫 `apiFetch('/api/...')` 取得結果
2. 更新對應 state
3. 呼叫 `updateRecord(recordId, { ...data, ...currentSettings })`
4. 自動捲動至下一步驟

```typescript
// Step 2: 生成文稿
// updateRecord 時補存當前設定（因使用者可能在上傳後修改設定）
if (recordId) await updateRecord(recordId, { script: data.script, speaker1, speaker2, dialogueStyle, tone });

// Step 3: 生成歌詞
if (recordId) await updateRecord(recordId, { lyrics: data.lyrics, styleId, lyricsDuration, musicStyle: ... });

// Step 4: 生成 Podcast 音訊
if (recordId) await updateRecord(recordId, { podcastBlob: blob, voice1, voice2 });

// Step 5: 生成音樂，完成後觸發背景 PPTX 生成
if (recordId) await updateRecord(recordId, { musicBlob: blob });
if (podcastBlob && script && pdfFile) generatePptxInBackground(blob);
```

### 21.5 背景 PPTX 生成

```typescript
const generatePptxInBackground = useCallback(async (mBlob: Blob) => {
  if (!podcastBlob || !script || !pdfFile) return;
  setPptxLoading(true);
  try {
    const slideCount = (slides.match(/投影片\s*\d+/g) ?? []).length || 5;
    const [podcastTimings, musicTimings] = await Promise.all([
      calcPodcastTimings(script, slideCount, podcastBlob),
      calcMusicTimings(slideCount, mBlob, lyrics),
    ]);
    const [pPptx, mPptx] = await Promise.all([
      generatePptx(pdfFile, podcastTimings, podcastBlob),
      generatePptx(pdfFile, musicTimings, mBlob),
    ]);
    setPodcastPptxBlob(pPptx);
    setMusicPptxBlob(mPptx);
    if (recordId) await updateRecord(recordId, { podcastPptxBlob: pPptx, musicPptxBlob: mPptx });
    setToast('簡報已準備好，可下載');
    loadHistory();
  } catch (e) {
    console.error('PPTX 生成失敗', e);
    setToast('PPTX 生成失敗：' + String(e));
  } finally {
    setPptxLoading(false);
  }
}, [podcastBlob, script, slides, lyrics, pdfFile, recordId]);

// 若先完成 podcast 再完成 music，也能觸發
useEffect(() => {
  if (step4State.status === 'done' && step5State.status === 'done' && musicBlob && !podcastPptxBlob) {
    generatePptxInBackground(musicBlob);
  }
}, [step4State.status, step5State.status, musicBlob, podcastPptxBlob, generatePptxInBackground]);
```

### 21.6 歷史紀錄還原

```typescript
function loadRecord(rec: GenerationRecord) {
  if (rec.speaker1)       setSpeaker1(rec.speaker1);
  if (rec.speaker2)       setSpeaker2(rec.speaker2);
  if (rec.dialogueStyle)  setDialogueStyle(rec.dialogueStyle);
  if (rec.tone)           setTone(rec.tone);
  if (rec.voice1)         setVoice1(rec.voice1);
  if (rec.voice2)         setVoice2(rec.voice2);
  if (rec.styleId)        setStyleId(rec.styleId);
  if (rec.lyricsDuration) setLyricsDuration(rec.lyricsDuration);
  // PDF 還原：從 Blob 重建 File 物件
  if (rec.pdfBlob) setPdfFile(new File([rec.pdfBlob], rec.pdfName, { type: 'application/pdf' }));
  if (rec.slides)         { setSlides(rec.slides);           setStep1State({ status: 'done' }); }
  if (rec.script)         { setScript(rec.script);           setStep2State({ status: 'done' }); }
  if (rec.lyrics)         { setLyrics(rec.lyrics);           setStep3State({ status: 'done' }); }
  if (rec.podcastBlob)    { setPodcastBlob(rec.podcastBlob); setStep4State({ status: 'done' }); }
  if (rec.musicBlob)      { setMusicBlob(rec.musicBlob);     setStep5State({ status: 'done' }); }
  if (rec.podcastPptxBlob) setPodcastPptxBlob(rec.podcastPptxBlob);
  if (rec.musicPptxBlob)   setMusicPptxBlob(rec.musicPptxBlob);
  setRecordId(rec.id);
  setDrawerOpen(false);
}
```

### 21.7 新專案

```typescript
function handleNewProject() {
  setPdfFile(null); setSlides(''); setScript(''); setLyrics('');
  setPodcastBlob(null); setMusicBlob(null); setPodcastPptxBlob(null); setMusicPptxBlob(null);
  setStep1State({ status: 'idle' }); setStep2State({ status: 'idle' });
  setStep3State({ status: 'idle' }); setStep4State({ status: 'idle' }); setStep5State({ status: 'idle' });
  setPptxLoading(false); setRecordId('');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
```

### 21.8 UI 元件（inline，不需額外元件檔）

- **StepCard**：步驟卡片，`step={number}` / `title` / `state` / `disabled`
- **LoadingBar**：動畫進度條
- **AudioPlayer**：`<audio controls>` + objectURL
- **TextBlock**：可展開/折疊的長文字，預設顯示前幾行
- **Toast**：頂部出現 3 秒後自動消失的通知

### 21.9 下載功能

```typescript
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadText(text: string, filename: string) {
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename);
}
```

### 21.10 Header 按鈕

```tsx
<header className="sticky top-0 z-30 ...">
  <h1>Podcast & Music Generator</h1>
  <div className="flex gap-2">
    <button onClick={handleNewProject}>＋ 新專案</button>
    <button onClick={() => { setDrawerOpen(true); loadHistory(); }}>歷史紀錄</button>
  </div>
</header>
```

---

## 22. 聲音試聽

```tsx
// 每個聲音選擇器旁加試聽按鈕
<button onClick={() => new Audio(voiceSampleUrl(v.name)).play()}>▶ 試聽</button>
// URL 格式：https://www.gstatic.com/aistudio/voices/samples/{name}.wav
```

---

## 23. 重大問題與解法

### 23.1 Turbopack Windows 崩潰

**症狀**：`DLLC process exited with exit code 0xc0000142`
**解法**：啟動時加 `--webpack` flag
```bash
npm run dev -- --port 4000 --webpack
```

### 23.2 pdfjs-dist v5 webpack 打包失敗

**症狀**：`TypeError: Object.defineProperty called on non-object` 在 `pdf.mjs:1`
**原因**：pdfjs-dist v5 是 ESM，webpack 打包時會將模組轉換為被凍結的命名空間（Sealed Namespace Object）。後續覆寫 `workerSrc` 時就會觸發 TypeError。
**解法**：用 `webpackIgnore` 從 CDN 直接在執行期載入，完全繞過 webpack。且因為 HTTPS 模組無法在建置期解析，必須加上 `// @ts-ignore` 才能通過 `npm run build`。
```typescript
// ✅ 正確 (app/page.tsx 與 lib/generatePptx.ts 皆同)
// @ts-ignore: bypass remote https import typing
const pdfjsLib = await import(/* webpackIgnore: true */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.min.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.worker.min.mjs';

// ❌ 錯誤 — 會被 webpack 凍結並在執行時崩潰
const pdfjsLib = await import('pdfjs-dist');
```

### 23.3 PDF 轉 base64 堆疊溢位

**症狀**：`RangeError: Maximum call stack size exceeded`
**原因**：`String.fromCharCode(...new Uint8Array(buffer))` 對大型 PDF 展開過多參數
**解法**：改用 FileReader
```typescript
// ✅ 正確
const pdfBase64 = await new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve((reader.result as string).split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

// ❌ 錯誤 — 大檔案崩潰
const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
```

### 23.4 TTS 回傳 "No audio data"

**原因**：script 中 speaker 名稱格式不符，或有非對話行干擾
**解法**：送出前預處理 script
```typescript
// ✅ 送給 TTS 的格式
"風格: 活潑對話"
"Speaker 1: 你好！"
"Speaker 2: 大家好！"

// ❌ 會導致無音訊
"Speaker 1 (阿哲): ..."   // 括號名稱讓 TTS 找不到 speaker
"投影片 1：標題"           // 非對話行干擾
```

### 23.5 lamejs 在 Node.js 崩潰

**症狀**：`ReferenceError: MPEGMode is not defined`
**原因**：lamejs 設計為瀏覽器全域用，在 Node.js 模組系統下各檔案作用域分離
**解法**：不用 lamejs，改用自訂 `pcmToWav()` 純函式

### 23.6 pptxgenjs node:fs 打包錯誤

**症狀**：`Module build failed: UnhandledSchemeError: Reading from 'node:fs'`
**解法**：`next.config.ts` 加 `NormalModuleReplacementPlugin` 剝除 `node:` 前綴，並加 `emptyModule` fallback

### 23.7 大型音訊回傳 "Failed to fetch"

**原因 1**：server 端用 `atob()` 逐字元迴圈解碼大型 base64 太慢
**原因 2**：回應沒有 `Content-Length` Header
**解法**：
```typescript
// ✅ Server side 用 Buffer.from
const pcmData = Buffer.from(audioData, 'base64');

// ✅ 加 Content-Length
headers: { 'Content-Length': String(wavData.byteLength) }
```

### 23.8 PPTX 開啟失敗

**原因**：手動操作 PPTX XML 時若 `[Content_Types].xml` 未更新，或 XML 結構錯誤，PowerPoint 拒絕開啟
**教訓**：複雜 XML 操作風險高，盡量使用 pptxgenjs 的標準 API（如 `slide.addMedia()`）

### 23.9 雲端部署建置 (Cloud Run) NextResponse 型別錯誤

**症狀**：`npm run build` 時 `app/api/generate-podcast/route.ts` 報錯 `Type 'Uint8Array' is not assignable to type 'BodyInit'` 或 Buffer 相關轉換錯誤。
**原因**：Next.js 在嚴格的 TypeScript 檢查下，部分 Node.js 基礎型別 (Buffer) 傳入 `NextResponse` 建構子不被允許。
**現行解法**（2026-04-11 更新）：使用 `Buffer.from(wavData.buffer, byteOffset, byteLength)` 直接傳入 `NextResponse`，避免中間 Blob 創建步驟；Node.js Buffer 在 Next.js App Router 環境下是有效的 `BodyInit`，且對大型二進位回應更可靠（不會造成 `net::ERR_FAILED 200 (OK)`）。
```typescript
const pcmData = Buffer.from(audioData, 'base64');
const wavData = pcmToWav(new Uint8Array(pcmData), sampleRate);
const wavBuffer = Buffer.from(wavData.buffer, wavData.byteOffset, wavData.byteLength);
return new NextResponse(wavBuffer, { headers: { 'Content-Type': 'audio/wav', ... } });
```

---

## 24. IndexedDB Schema

- **DB 名稱**：`podcast-generator`
- **Version**：1
- **Store**：`records`，keyPath: `id`
- **儲存**：所有 Blob（PDF、音訊、PPTX）可直接存入 IndexedDB，取出後型別為 Blob
- **還原 File**：`new File([rec.pdfBlob], rec.pdfName, { type: 'application/pdf' })`
- **帳號隔離**：
  - `AUTH_ENABLED=false`：所有本機歷史共用同一份 store
  - `AUTH_ENABLED=true`：每筆紀錄額外帶 `ownerEmail`，並以 lowercase 正規化
  - `getRecordsByOwner(ownerEmail)` 只回傳該 email 的紀錄
  - `updateRecord(id, updates, ownerEmail)` / `deleteRecord(id, ownerEmail)` 會驗 owner，避免跨帳號修改或刪除

---

## 25. 完整工作流程圖

```
若 AUTH_ENABLED=true：
    invitation code + Google 登入
        ↓
    取得 session token（存 localStorage）
        ↓
使用者輸入 API Key（存 sessionStorage，關閉分頁清除）
    ↓
Step 0：設定說話者角色、TTS 聲音、歌曲風格、歌詞長度
    ↓
Step 1：上傳 PDF → FileReader base64 → /api/parse-pdf → Gemini 原生解析 → slides 文字
    ↓  建立 IndexedDB 紀錄（存 pdfBlob + 設定 + ownerEmail）
Step 2：/api/generate-script → Gemini → Podcast 對話文稿
    ↓  updateRecord(script + speaker settings)
Step 3：生成 Podcast 音訊
    ├─ API 路徑：/api/generate-podcast → extractDialogue → Gemini TTS → PCM→WAV
    └─ Upload 路徑：接受 mp3 / wav / m4a / aac
    ↓  updateRecord(podcastBlob + podcastSource + voice settings)
Step 4：/api/align-podcast
    ↓  4.1：Whisper / Gemini 產出或修正 SRT
    ↓  4.2：Gemini 或本地 LLM 找每頁 startSrtId
    ↓  buildSlideTimingsFromSrtIds / fallback
    ↓  generatePptx(pdf, timings, podcastBlob)
    ↓  updateRecord(podcastPptxBlob + podcastSrt + diagnostics + timings)
Step 5：/api/generate-lyrics → Gemini → 機器解析友善歌詞（[Verse] [Slide N]）
    ↓  updateRecord(lyrics + style settings)
Step 6：生成歌曲音訊
    ├─ API 路徑：/api/generate-music → Lyria → MP3
    └─ Upload 路徑：接受 mp3
    ↓  updateRecord(musicBlob + musicSource)
Step 7：/api/align-music
    ↓  7.1：Whisper / Gemini 產出或修正 SRT
    ↓  建立 slide anchor summary
    ↓  7.2：Gemini 或本地 LLM 找每頁 startSrtId
    ↓  buildSlideTimingsFromSrtIds / lyrics-weight fallback
    ↓  generatePptx(pdf, timings, musicBlob)
    ↓  updateRecord(musicPptxBlob + musicSrt + diagnostics + timings)
    ↓
下載：script.txt / lyrics.txt / podcast.wav(or 原始上傳格式) / music.mp3 / podcast.srt / music.srt / podcast.pptx / music.pptx / podcast.mp4（選用） / music.mp4（選用）
（實際下載檔名帶 _HHmmss 時間標籤，例如 podcast_181646.pptx；按鈕顯示名稱維持短名稱）
```

---

## 26. 已知限制

- Podcast 音訊為 WAV（未壓縮），檔案較大（~10-20MB）
- 歷史紀錄含所有 Blob，多筆後 IndexedDB 佔用空間可觀（每筆 30-50MB）
- PPTX 已補寫 timing XML 以提高自動播放與跨投影片播放相容性，但不同版本的 PowerPoint 仍可能有差異
- CDN 載入 pdfjs 需要網路連線（首次 PPTX 生成時約 1MB 下載）
- TTS 多人語音使用 `gemini-2.5-flash-preview-tts`，預覽模型可能有 quota 限制

---

## 27. 資安防護與邊界檢查

為確保開源後可安全部署於公共伺服器（如 Cloud Run），專案加入以下安全與成本管控機制：

### 27.1 BYOK 無伺服器金鑰架構
- 原始碼與環境環境變數完全不儲存 API Key。
- 前端發送 Request 前使用 `sessionStorage` 中的金鑰，配合字串 XOR 與 base64 進行簡易模糊化（防止網路工具明文側錄）。
- 瀏覽器分頁關閉後金鑰即銷毀，後端實作純無狀態代理 (`getAI(req)` 動態擷取 Header 金鑰初始化)。

### 27.2 PDF 前端前置過濾 (Token 節流)
為防止惡意使用者上傳百頁以上的大型文獻檔，耗盡使用者的 Gemini Token 額度，在 `app/page.tsx` 實作前端邊界攔截：
1. **副檔名與 Type 檢查**：非 PDF 拒絕上傳。
2. **CDN 套件頁數檢查**：透過動態載入的 WebpackIgnore 版 `pdfjs-dist` 預先讀取檔案陣列 (`ArrayBuffer`) 解析 `numPages`。
3. **3-15 頁防呆機制**：若頁數不在此範圍，直接中斷執行並拋出前端錯誤通知，**絕不**將超過限制的 PDF 送往後端與 Gemini 解析，達到零空耗 Token 的防護。

---

## 28. 影片匯出（Video Export）

### 28.1 架構概覽

MP4 影片匯出為選用功能，需設定 `VIDEO_EXPORT_ENABLED=true`，並在容器中安裝 FFmpeg（Dockerfile 已內建）。

| 元件 | 說明 |
|------|------|
| `app/api/export-video/route.ts` | API Route，處理並行限制、請求驗證、呼叫 generateVideo() |
| `lib/videoExport.ts` | FFmpeg 邏輯：xfade / concat args builder、並行計數、啟動清理 |
| `components/VideoExportBlock.tsx` | 前端卡片元件：session 快取、503 自動重試、forceRegen |
| `instrumentation.ts` | 伺服器啟動時清理 `/tmp/video-export` 殘留目錄（容器被強制終止後的防呆） |

### 28.2 並行控制

```typescript
// lib/videoExport.ts
export function getMaxConcurrentExports(): number {
  const manual = parseInt(process.env.VIDEO_MAX_CONCURRENT ?? '0', 10);
  if (manual > 0) return manual;
  // Auto: (totalMemMB - 500) / 340，每個 FFmpeg job ~340MB
  const totalMemMB = os.totalmem() / (1024 * 1024);
  return Math.max(1, Math.floor((totalMemMB - 500) / 340));
}
```

超過並行上限回傳 `503 { error: "伺服器忙碌中（N/M），請稍後再試" }`。

**建議設定（依記憶體）：**
| 記憶體 | VIDEO_MAX_CONCURRENT | VIDEO_FFMPEG_PRESET |
|--------|---------------------|---------------------|
| 2Gi | 1 | fast |
| 4Gi | 2 | fast |
| 8Gi | 4 | medium |
| 128Gi | 48 | fast |

### 28.3 xfade 轉場

`transition='fade'` 且投影片數 > 1 時使用 `buildXfadeArgs()`，否則使用 `buildConcatArgs()`（concat demuxer）。

**時序計算（plan_K 修正版）：**
```
fadeDur[i] = resolveEffectiveTransitionSec(timings[i].durationSec)
           = clamp(0.1, 0.75, durationSec * 0.3, 但不超過 durationSec - 0.1)
           （與 PPTX buildTransitionAdjustedTimings() 使用同一函式）

xfade offset（直接公式，非累積）：
  offset[i] = timings[i].endSec - fadeDur[i]
  （timings[i].endSec 為原始 SRT 對齊後的新頁可見時間點）

每張投影片 FFmpeg input -t（含 carry-in）：
  t[i] = timings[i].durationSec + sum(fadeDur[i+1..n-1]) + 2.0（僅最後一張加 2.0）
  （carry-in 確保 xfade 有足夠素材，不提早截斷後段轉場）

不加 -shortest：讓影片跑完延伸時間，最後 2 秒靜止畫面
```

> PPTX 與 MP4 共用 `resolveEffectiveTransitionSec()`，確保「新頁完全可見的時間點」在兩者之間語意完全一致。timings 代表原始對齊後的時間，PPTX 輸出時透過 `buildTransitionAdjustedTimings()` 扣除轉場時長，MP4 直接用 offset 公式推算，二者最終呈現效果相同。

### 28.4 timings state 同步（PPTX ↔ MP4 幀數一致性）

`buildPodcastPptxFromConfirmedSrt()` / `buildMusicPptxFromConfirmedSrt()` 在從 cue events 推算出 `timings` 後，**必須立即同步 `setPodcastTimings` / `setMusicTimings`**，否則 `VideoExportBlock` 收到的是舊版 `normalizeTimings` 輸出（長度 = PDF 頁數），導致 MP4 比 PPTX 多輸出捨棄的末頁。

```
buildSlideCueEvents(cues, srtEntries)     → events (11 筆，若使用者只標 11 個 cue)
buildTimingsFromSlideCueEvents(events)    → timings (11 筆)
setPodcastTimings(timings)               ← 必須同步，VideoExportBlock 才能拿到正確長度
buildTransitionAdjustedTimings(timings)  → adjustedTimings → generatePptx()
```

若省略同步步驟：
- `podcastTimings` state 仍為 12 筆（align API 回傳值）
- `VideoExportBlock timings={podcastTimings}` → 12 筆
- `buildOrderedImagesFromTimings(allImages, 12-timings)` → 12 張圖
- PPTX 11 頁，MP4 12 頁 → 不一致

### 28.5 前端 VideoExportBlock 狀態機

```
idle
  ↓ 點擊生成
rendering    → pdfToJpegBase64()（PDF 僅渲染一次，retry 不重跑）
  ↓
uploading    → POST /api/export-video
  ↓ 503 && attempt ≤ 5
waiting      → 等 10 秒後回到 uploading（琥珀色，顯示第 N/5 次）
  ↓ 成功
idle(cached) → onCached(blob)；triggerDownload()；顯示「✓ 已生成・再次下載」
  ↓ 點「重新生成」
idle(forceRegen) → 跳過快取重走流程
  ↓ 錯誤（非 503 或超過 5 次重試）
error        → 顯示錯誤訊息 + 手動「重試」按鈕
```

### 28.5 燒入字幕（Burn Subtitles）

若已產生 SRT，可在 VideoExportBlock 內勾選「燒入字幕」，FFmpeg 將字幕永久嵌入畫面（hard-coded）。

**前端流程：**
- `hasSrt = Boolean(srtText)` — SRT prop 存在時顯示 checkbox，消失時自動取消勾選（`useEffect`）
- `getExportFilename(filename, burnSubs && hasSrt)` — 產生 `.subbed.mp4` 後綴
- `onCached(blob, filename)` — 將實際檔名傳回 parent，快取版與燒字幕版可同時存在不衝突
- `onClearCache()` — 勾選 / 取消勾選時通知 parent 清除快取，避免舊版本被再次下載

**後端流程（`lib/videoExport.ts`）：**
```
params.burnSubs && params.srtText
  ↓
寫入 workDir/subtitles.srt
escapeSrtPath(srtPath)  → 路徑冒號跳脫（Windows 相容）
concat 模式：-vf "subtitles='...':force_style='...'"
xfade 模式：filter_complex 末段 [vxf] → subtitles filter → [vout]
```

**字型樣式（`buildSubtitleStyle(variant)`，v24 起以 function 取代舊 `SUBTITLE_STYLE` 常數）：**

| variant | force_style | 視覺 |
|---|---|---|
| `opaque`（預設） | `Fontname=Noto Sans CJK TC,Fontsize=22,BackColour=&HB0000000,BorderStyle=3,Outline=1,Shadow=0` | v21 的半透明黑底 banner，可讀性最高 |
| `translucent` | `Fontname=Noto Sans CJK TC,Fontsize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&HF8000000,BorderStyle=3,Outline=1,Shadow=0` | 底幾乎不存在（Alpha=&HF8 ≈ 2% 不透明）＋白字黑邊維持可讀性 |
| `outline` | `Fontname=Noto Sans CJK TC,Fontsize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0` | 無 banner、純白字黑邊；淺色/純色簡報最乾淨 |

ASS Alpha 提示：`&HAA……` 中 `00` = 完全不透明、`FF` = 完全透明；`&HB0`≈31%、`&HF8`≈2%。`BorderStyle=1` 僅描邊＋陰影；`BorderStyle=3` 才是背景矩形。

**Docker 字型：**
runner stage 安裝 `fontconfig font-noto-cjk`，確保繁中字幕不缺字。

**`VideoExportBlock` props 更新：**
| prop | 型別 | 說明 |
|------|------|------|
| `srtText` | `string \| null \| undefined` | SRT 內容；有值才顯示 checkbox |
| `cachedFilename` | `string \| null \| undefined` | 快取影片的實際檔名（含 `.subbed` 後綴） |
| `onCached` | `(blob: Blob, filename: string) => void` | 快取完成回調，同時回傳實際檔名 |

**v24 新增內部 state**（`VideoExportBlock.tsx`）：
- `subtitleStyle: SubtitleStyle`（`useState<SubtitleStyle>('opaque')`）— 使用者選擇的字幕外觀；切換時呼叫 `onClearCache()` 清除快取，避免下載到舊樣式版本
- `SUBTITLE_STYLE_HINT: Record<SubtitleStyle, string>` — 每個選項的中文提示文字；select 下方動態渲染
- select 僅在 `burnSubs === true` 時渲染；未勾選燒字幕時欄位完全隱藏，避免干擾預設流程

### 28.6 環境變數

| 變數 | 說明 | 預設 |
|------|------|------|
| `VIDEO_EXPORT_ENABLED` | 啟用影片匯出 | `false` |
| `NEXT_PUBLIC_VIDEO_EXPORT_ENABLED` | 前端顯示匯出按鈕（build-time） | `false` |
| `VIDEO_MAX_CONCURRENT` | 最大並行數（0 = 自動依記憶體） | `0` |
| `VIDEO_FFMPEG_PRESET` | FFmpeg H.264 preset（空 = 自動依 CPU） | `` |
| `VIDEO_FFMPEG_BIN` | FFmpeg bin 目錄（僅 Windows 本地開發） | `` |

## 29. 部署指南 (Deployment)

專案支援多種實體部署方式，詳細操作可參考 `README.md`。此處說明 LLM 重建所需的核心部署設定檔：

### 28.1 Dockerfile (Multi-stage Build)
使用標準的 Next.js 分段建置，減少 Image size 並提升安全性：
- **Stage 1 (deps)**: 安裝 dependencies
- **Stage 2 (builder)**: 執行 `npm run build`
- **Stage 3 (runner)**: 使用 standalone 模式運行，暴露 port 3000

### 28.2 Docker Compose
使用 `docker-compose.yml` 管理服務，映射 3000 port，並加入健康檢查機制作為 Production 的穩定執行方式。

### 28.3 Google Cloud Run
完全由全託管 Serverless 運行：
```bash
npm run build && \
gcloud run deploy deckcast \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --project [YOUR_PROJECT_ID]
```
必須先在本地端執行 `npm run build` 確認 TypeScript 檢查通過後再推送至 Cloud Run，以節省雲端建置的漫長等待時間與運算成本。

## 30. 版本紀錄補充

### ✨ v08 補充亮點（2026-04-11）— plan_F 三種語音表達模式

#### 30.1 NarrationMode（三模式切換）

新增 `NarrationMode` 型別，取代原本固定的「雙人 Podcast」設計：

```ts
export type NarrationMode = 'duo' | 'solo_explainer' | 'solo_story';
```

| 模式 | 說明 | TTS speakerVoiceConfigs |
|------|------|-------------------------|
| `duo` | 雙人對談（原預設） | Speaker 1 + Speaker 2 |
| `solo_explainer` | 單人講解（教學型） | 僅 Speaker 1 |
| `solo_story` | 單人說故事（敘事型） | 僅 Speaker 1 |

#### 30.2 三套獨立 Prompt 模板

`lib/prompts.ts` 廢棄單一 `PODCAST_PROMPT_TEMPLATE`，改為三套分離模板：

- `DUO_PODCAST_PROMPT_TEMPLATE`：雙人，Speaker 1 / Speaker 2 交替，自然收尾（移除強制開放式問題規則）
- `SOLO_EXPLAINER_PROMPT_TEMPLATE`：單人，Speaker 1，教學風格，穩定清晰
- `SOLO_STORY_PROMPT_TEMPLATE`：單人，Speaker 1，敘事風格，情境鮮明

dispatcher 函式 `buildNarrationPrompt({ mode, speaker1, speaker2?, dialogueStyle, tone })` 依 mode 分發對應模板，取代原本的 `buildPodcastPrompt`。

#### 30.3 lyricsSource 內容解耦

歌詞生成不再必然使用 podcast 文稿作為輸入：

| 模式 | 歌詞輸入來源 | 說明 |
|------|-------------|------|
| `duo` | `script`（podcast 對話稿） | 維持原有行為（⚠️ 暫時策略，雙人文稿語氣仍可能影響歌詞） |
| `solo_explainer` | `slides`（原始投影片文字） | 直接繞過文稿，避免語氣污染 |
| `solo_story` | `slides`（原始投影片文字） | 同上 |

`generate-lyrics` route 新增 `lyricsSource` 欄位，優先於 `script` 使用。

#### 30.4 TTS 實際修正（與原 plan_F 設計有出入）

**原 plan_F 設計（已作廢）**：單人模式送 1 個 `speakerVoiceConfigs`。
**實際 Gemini API 限制**：`multi_speaker_voice_config` 要求 `enabled_voices` 必須剛好等於 2，送 1 個直接回傳 400。

**實際修正方案**：
- solo 模式完全不用 `multiSpeakerVoiceConfig`，改用單聲道 `voiceConfig`：
  ```ts
  // duo
  speechConfig = { multiSpeakerVoiceConfig: { speakerVoiceConfigs: [Speaker1, Speaker2] } }
  // solo
  speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice1 } } }
  ```
- 新增 `extractSoloScript()` 函式，solo 模式不再走 `extractDialogue()`：
  - 提取 `風格:` 行內容作為朗讀風格指令
  - 剝除所有 `Speaker 1:` 前綴（單聲道 TTS 不需要講者標籤）
  - 過濾掉投影片標題行（`投影片 N：`）
  - 組成 `Read the following script... Style: <風格>\n\nScript:\n<純台詞>` 格式送給 TTS

#### 30.5 模式切換狀態失效（handleNarrationModeChange）

切換模式時，`handleNarrationModeChange()` 會：

1. 清除所有模式派生內容：`script`、`lyrics`、SRT、timings、diagnostics
2. 重置 step 2–7 狀態為 `idle`
3. **保留** `podcastBlob` / `musicBlob` / `podcastPptxBlob` / `musicPptxBlob`（已產出的音訊與簡報仍可下載）
4. 立即呼叫 `updateRecord(recordId, { narrationMode: mode, script: undefined, ... })` 同步寫入 IndexedDB

`loadRecord()` 直接呼叫 `setNarrationMode(rec.narrationMode ?? 'duo')`，不通過 handler，避免重複觸發 IndexedDB 寫入循環。

#### 30.6 模式感知 UI

- Step 0 新增三按鈕切換列（雙人對談 / 單人講解 / 單人說故事）
- 雙人模式顯示 Speaker 2 描述欄位與 Voice 2 選擇；單人模式隱藏
- Step 2 / 3 / 4 標題與 loading 訊息依模式動態調整
- `GenerationRecord` 新增 `narrationMode?: NarrationMode` 欄位，隨專案存入 IndexedDB


## v21 — TTS 分段字數上限依內容語言倍率調整（plan_B）

> 動機：`TTS_CHUNK_CHARS = 800` 對中文剛好 ~145 秒，但英文 TTS 語速約 825
> chars/min，同樣 800 字只有 ~58 秒，chunk 切得過碎、浪費 Gemini 呼叫，UI
> 估時也會誤算為中文語速導致長稿警示誤觸發。日韓語速也與中文有落差。
> 本版把 `TTS_CHUNK_CHARS` 降為「中文基準常數」，另加 per-language 倍率，
> 讓每個 chunk 的**實際音訊長度**在四語言都壓在 145-160 秒區間。

- **倍率 map**（`lib/constants.ts`）：

  | 語言 | 倍率 | `effectiveChunkChars` | 對應音訊長度 |
  |---|---:|---:|---:|
  | zh-TW | 1.00x | 800 | ~145s |
  | en | 2.50x | 2000 | ~145s |
  | ja | 1.50x | 1200 | ~160s |
  | ko | 1.25x | 1000 | ~145s |

  ```ts
  export const TTS_CHUNK_LANG_MULTIPLIER: Record<ContentLanguage, number> = {
    'zh-TW': 1.0, en: 2.5, ja: 1.5, ko: 1.25,
  };

  export function resolveTtsChunkChars(language?: ContentLanguage): number {
    const lang = language ?? DEFAULT_CONTENT_LANGUAGE;
    const mult = TTS_CHUNK_LANG_MULTIPLIER[lang] ?? 1.0;
    return Math.round(TTS_CHUNK_CHARS * mult);
  }
  ```

- **向後相容**：`resolveTtsChunkChars(undefined)` fallback 到 zh-TW 基準 800
  chars；舊 IndexedDB 紀錄（無 `contentLanguage` 欄位）行為與過往完全一致。

- **語速係數雙軸化**（`lib/ttsEstimate.ts`）：
  `CHARS_PER_MIN` 從 `Record<NarrationMode, number>` 擴成
  `Record<NarrationMode, Record<ContentLanguage, number>>`。
  zh-TW 數值為 2026-04-19 UI 遷移時的實測校正基準（duo=330 / solo_explainer=345
  / solo_story=300）；en / ja / ko 依倍率推算，尚未實測微調。

  `estimateTtsDuration()` 新增可選 `language` 參數（預設 `'zh-TW'`，向後相容）。
  `estimateChunkCount()` 簽名不變（仍吃明確的 `chunkChars`），呼叫端透過
  `resolveTtsChunkChars()` 傳入語言感知的 `effectiveChunkChars`。

- **呼叫點**：
  - `app/api/generate-podcast/route.ts`：切段前先算
    `const effectiveChunkChars = resolveTtsChunkChars(contentLanguage);`，再傳給
    `splitScriptIntoChunks()`；`console.log` 一併輸出 `effectiveChunkChars`。
  - `app/page.tsx`：line 1999-2000（長稿警示）與 line 2049-2050（TTS 生成模式
    顯示）兩處同步改用語言感知版本；`estimateTtsDuration` 多帶 `contentLanguage`。

- **警示閾值不動**：`TTS_WARN_SEC = 200` / `TTS_LONG_SEC = 320` 是對**實際音訊
  秒數**的門檻，`estimateTtsDuration` 依語言算出正確秒數後，閾值邏輯自動正確。
  英文 3000 字 script 修正前會被中文係數誤算為 ~545 秒（誤觸長稿警示），修正
  後正確算出 ~218 秒，只觸發中稿建議「改用自動分段」。

- **Chunked 模式行為承接 plan_A**：每個 chunk 開頭仍重新注入原始 preamble，確保
  段與段之間聲線 / 口音 / 節奏一致；`blockChars` 仍不含 preamble，長 preamble
  不會擠掉對白字數。

- **測試（97 tests 全綠，+7 cases）**：
  - `resolveTtsChunkChars` 五個 lookup：zh-TW=800 / en=2000 / ja=1200 /
    ko=1000 / undefined=800（fallback 驗證）
  - 語言感知切段邊界：1800-char script 在 zh-TW 基準（800）下至少切 3 段；
    同一份 script 在 en 倍率（2000）下只切成 1 段

- **風險點**：en=2.5x 與 ko=1.25x 是**估算值，尚未真實 TTS 聽測驗證**。若實機跑
  出音訊 > 3 分鐘或後段破音，fallback 策略是：
  - en → 降 `TTS_CHUNK_LANG_MULTIPLIER.en` 為 2.0（1600 chars）
  - ko → 降為 1.1（880 chars）

  改動為 `lib/constants.ts` 一行修改，不需 revert 整個 commit。

## v20 — Podcast 文稿 preamble 升級為 AUDIO PROFILE 多區塊

> 歷程備註：v20 初版曾試圖把 AUDIO PROFILE 壓縮為 `Make Speaker N sound like ...`
> per-speaker directive、並以 `[Voice direction — do not read this block aloud]`
> 框架包住送進 Gemini TTS；實測造成 `TypeError: Failed to fetch`（TTS 回應異常
> 觸發 dev server 斷線）。改以 Python SDK 參考實作為 ground truth，確認 Gemini
> multi-speaker TTS 本身就能吸收整段 AUDIO PROFILE markdown 作為情境語境，且不會
> 把 `#` / `##` / `Style:` 等 markdown 標記念出來。以下為最終落地行為。

- **舊格式**：Step 2 `/api/generate-script` 第一行輸出 `風格: [...]` 單行，TTS
  在 `extractDialogue` / `extractSoloScript` 擷取此行作為朗讀指令。
- **新格式**：Step 2 改輸出結構化的多區塊 preamble：

  ```
  # AUDIO PROFILE

  ## Speaker1: 「persona 標籤」
  Style: ...
  Accent: ...
  Pacing: ...

  ## Speaker2: 「persona 標籤」     ← 只在 duo 模式出現
  Style: ...
  Accent: ...
  Pacing: ...

  # SCENE
  1-3 句場景描述

  # SAMPLE CONTEXT
  1-3 句情境鋪陳

  投影片 1：[標題]
  Speaker 1: ...
  ```

- **Prompt 改動**（`lib/prompts.ts`）：
  - `DUO_PODCAST_PROMPT_TEMPLATE` / `SOLO_EXPLAINER_PROMPT_TEMPLATE` /
    `SOLO_STORY_PROMPT_TEMPLATE` 範例章節全部改成 AUDIO PROFILE 新樣板
  - `buildLanguageBlock` 的「不可翻譯標記列表」新增 8 個新 label
  - `buildAudioTagsBlock` 規則 1 擴充禁止在任何 preamble 行加 tag
- **共用模組**（`lib/scriptFormat.ts`，新建）：
  - `PREAMBLE_BLOCK_RE`：抓整個 AUDIO PROFILE 區塊（停在第一個 `投影片 N：` 之前）
  - `LEGACY_STYLE_LINE_RE`：舊格式單行 `風格:` 的相容 fallback
  - `PREAMBLE_LINE_RE`：用於 fallback SRT 的單行過濾（共用給 align-podcast）
  - `extractPreamble` / `extractSpeakerBlock` / `summarizePreambleForTts`：
    三個 parser helper
  - `extractDialogue` / `extractSoloScript` / `splitScriptIntoChunks`：
    從 `app/api/generate-podcast/route.ts` 搬家到此，同時支援新舊格式
- **TTS 輸入策略（Python-parity，最終版）**：
  - **Duo `extractDialogue`**：`${preamble}\n\n${dialogueLines}` — 整段
    markdown preamble 原封不動送進 Gemini TTS；`multiSpeakerVoiceConfig`
    的 `speakerVoiceConfigs` 做 speaker↔voice 對應；`Speaker N (角色名):`
    括號仍然剝除，確保 speaker label 與 config 完全一致。
  - **Solo `extractSoloScript`**：指令改為
    `Read the following script naturally. Do not read the word "Script:" or any metadata.`
    後接 `Delivery profile:\n${preamble}\n\nScript:\n${dialogueLines}`；
    Script: 區塊只含 Speaker 1 對白。
  - **SCENE / SAMPLE CONTEXT 一併送進 TTS**：Gemini 能把它們當情境語境吸收，
    對聲音表現有加分；舊版嘗試強制剝除反而稀釋效果。
  - **不再使用 `Make Speaker N sound like ...` 與 `[Voice direction — do not
    read this block aloud]`**：這兩個 pattern 是 v20 初版自行發明的語法，不
    是 Gemini 文件行為；實測會讓 Gemini 回非 audio 或 crash。
  - **不嘗試 `speechConfig.voiceInstructions`**：已驗證當前 `@google/genai`
    SDK 不支援此欄位，不要寫進 fallback 計畫。
  - `summarizePreambleForTts(preamble, mode)` 仍 export 供測試 / 未來實驗
    使用，但生產路徑已不再呼叫。
- **Chunked 模式**：`splitScriptIntoChunks` 每個 chunk 開頭重新注入原始
  markdown preamble（新格式 → `# AUDIO PROFILE ...`；舊格式 → `風格: ...`）。
  字數預算（`blockChars`）計算不含 preamble，維持與舊版 `風格:` 單行相同語意。
- **Markdown preservation**（`lib/stripMarkdown.ts`）：`/api/generate-script`
  pipeline 走 `stripMarkdown()`，原本 `^#{1,6}\s+` 會把 `# AUDIO PROFILE` /
  `## Speaker1:` 前綴一起剝掉；新增 `PRESERVED_HEADING_RE` 白名單精確保留
  `# AUDIO PROFILE` / `## Speaker1:` / `## Speaker2:` / `# SCENE` /
  `# SAMPLE CONTEXT` 五個結構性標題，其他 Markdown 標題仍正常 strip。line-by-line
  transform（若該行匹配 `PRESERVED_HEADING_RE` 跳過 heading strip；其餘 regex
  照舊處理 bold / italic / list / code-fence / link / hr）。`## Speaker3:` 與
  `## Speaker 1:`（中間有空格的變體）仍被當成普通 markdown strip。
- **align-podcast**（`app/api/align-podcast/route.ts`）：`buildFallbackPodcastSrt`
  改用共用 `PREAMBLE_LINE_RE`；Speaker 名字前綴（`Mary老師:` / `阿哲:` 等）
  為 per-script persona tag 不是格式標記，保留獨立 filter。
- **lib/srt.ts lyrics fallback**：`buildFallbackSrtEntriesFromLyrics` 亦套用
  `PREAMBLE_LINE_RE` 作 defense-in-depth；歌曲 header metadata
  （`歌曲名稱:` / `總時長:` / `節奏:` / `關鍵元素:`）仍由既有 filter 清理。
- **向後相容**：IndexedDB 內舊格式 script（以 `風格:` 開頭）仍走 legacy 分支，
  行為與過往完全一致；新舊格式在同一後端自動分流。
- **測試（90 tests 全綠）**：
  - `__tests__/scriptFormat.test.ts`：46+ 個 cases 覆蓋新舊格式 parser、
    per-speaker 擷取、Python-parity 契約（整段 markdown 送進 TTS，禁止出現
    `[Voice direction` / `Make Speaker N sound`）、Solo `Script:` 區塊純淨性、
    chunk preamble 重注入、`PREAMBLE_LINE_RE` 正負案例邊界。
  - `__tests__/stripMarkdown.test.ts`（新）：8 cases — 一般 markdown strip、
    五個 preserved headings 保留、其他 heading 仍被 strip、`## Speaker3:` /
    `## Speaker 1:`（有空格）當 plain markdown 處理。
  - `__tests__/srt.test.ts`（+5 regression）：`buildFallbackSrtEntriesFromLyrics`
    正常歌詞保留、句中含 style/accent/pacing 子字串不誤刪、podcast preamble
    洩入時會被正確 strip、歌曲 header 清理、全 metadata 區塊輸出 0 entries。

## v19 — Step 2 Audio Tags 語氣標籤

- Step 2 生成區新增「自動加入語氣標籤（Audio Tags）」checkbox（預設關閉，位於生成按鈕上方）
- 勾選後，`buildNarrationPrompt()` 附加 `buildAudioTagsBlock(mode)` 規則 block，腳本自動插入少量白名單 tags
- 白名單 12 個：`[neutral]` / `[enthusiasm]` / `[interest]` / `[curiosity]` / `[positive]` / `[tension]` / `[slow]` / `[fast]` / `[short pause]` / `[long pause]` / `[whispers]` / `[laughs]`（定義於 `lib/constants.ts` `ALLOWED_AUDIO_TAGS`）
- Tags 規則：每句最多 1 個、每頁最多 2–3 個、不可連續相鄰、只能出現在 `Speaker` 台詞行；`solo_explainer` 偏保守、`solo_story` 可敘事性、`duo` 更保守
- Step 3 `extractDialogue()` / `extractSoloScript()` 不清除行內 tags，TTS 直接接收帶 tags 腳本（驗證，不改碼）
- Step 2「複製全文」`copyMode="speaker-only"` 僅過濾非 Speaker 行，tags 連同台詞一併保留（驗證，不改碼）
- `audioTagsEnabled` 寫入 `GenerationRecord`：Step 1 上傳時存入初始值、Step 2 生成後 updateRecord、checkbox 切換時立即持久化
- `handleNewProject()` 不重置此偏好（跨專案保留，設計與 `narrationLengthPreset` 一致）
- 不綁定特定 TTS 模型：checkbox 一律顯示，推薦文案說明 `gemini-3.1-flash-tts-preview` 效果最佳

## v18 — Step 5 歌詞內容依據選擇

- Step 5 新增「歌詞內容依據」下拉選單
- 預設使用 `script`（依講稿生成），可切換為 `slides`（依投影片生成）
- `lyricsContentSource` 寫入 `GenerationRecord`
- 切換歌詞內容依據時，既有 `lyrics` 與 Music 鏈下游一律失效並清除
- `duo / solo_*` 三種模式均可使用兩種來源，不再綁定模式

## v17 — Step 5 歌詞手動後製編修

- Step 5 升級為「生成 + 後製編修」模式，與 Step 2 文稿編修對稱
- 新增 `isEditingLyrics` / `lyricsDraft` 雙軌（draft 不持久化）
- 新增三個 handler：`handleStartLyricsEdit` / `handleCancelLyricsEdit` / `handleSaveLyricsEdit`
- 歌詞儲存後清除 Music 鏈（musicBlob / SRT / timings / PPTX / MP4）
- `lyricsGeneratedAt` 在手動儲存時同步更新
- 編輯期間 Step 6 / 7 disabled
- 所有模式（duo / solo_*）統一以 `script` 作為歌詞生成來源，移除 `lyricsSource = slides` 路徑
- `handleSaveScriptEdit` 擴展：所有模式儲存 script 後都清 lyrics / Music 鏈（原本只有 duo）
