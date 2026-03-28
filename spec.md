# Podcast & Music Generator — spec_v02

> 本文件供 LLM 閱讀，從零重現此專案。包含完整架構、所有程式碼、遇到的問題與解法。

---

## 1. 專案概述

**功能**：使用者上傳 PDF 投影片，系統依序產生：
1. Podcast 對話文稿
2. AI 歌詞
3. Podcast 音訊（WAV）
4. AI 歌曲音訊（MP3）
5. 兩份 PPTX 簡報（各內嵌對應音訊，有自動換頁計時）

**架構**：
- **Frontend**：Next.js App Router，`'use client'` 單頁應用
- **Backend**：Next.js API Routes，純代理角色，轉發 Gemini API
- **儲存**：瀏覽器 IndexedDB（含 Blob 儲存），不需後端資料庫
- **BYOK**：使用者自備 Gemini API Key，存於 `sessionStorage`

---

## 2. Tech Stack

| 項目 | 版本 |
|------|------|
| Next.js | 16.2.1 |
| React | 19.2.4 |
| TypeScript | ^5 |
| Tailwind CSS | ^4 |
| @google/genai | ^1.46.0 |
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

npm install @google/genai idb jszip pptxgenjs pdfjs-dist lamejs
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
│       ├── parse-pdf/route.ts
│       ├── generate-script/route.ts
│       ├── generate-lyrics/route.ts
│       ├── generate-podcast/route.ts
│       └── generate-music/route.ts
├── lib/
│   ├── constants.ts       ← 所有常數與提示詞
│   ├── types.ts           ← TypeScript 型別
│   ├── getAI.ts           ← Gemini 初始化（server side）
│   ├── apiFetch.ts        ← fetch 封裝（client side）
│   ├── prompts.ts         ← 提示詞建構函式
│   ├── stripMarkdown.ts   ← 移除 Markdown 標記
│   ├── db.ts              ← IndexedDB CRUD
│   ├── timing.ts          ← 音訊時間計算
│   ├── generatePptx.ts    ← PPTX 生成（client side）
│   ├── pdfToImages.ts     ← PDF 轉圖（含 getAudioDuration）
│   └── empty-module.js    ← webpack fallback
└── public/
    └── pdf.worker.min.mjs ← 從 pdfjs-dist 複製
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
gemini-3-flash-preview       → 文字生成（文稿、歌詞、PDF 解析）
gemini-2.5-flash-preview-tts → 多人 TTS 語音合成
lyria-3-pro-preview          → AI 音樂生成
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

## 10. lib/constants.ts（完整）

```typescript
export const API_KEY_HEADER = 'X-Gemini-Key';
export const API_KEY_SEED   = 'pcast-gen-2024';
export const SESSION_KEY    = 'gemini_key';

export const MODEL_TEXT  = 'gemini-3-flash-preview';
export const MODEL_MUSIC = 'lyria-3-pro-preview';
export const MODEL_TTS   = 'gemini-2.5-flash-preview-tts';

export const DEFAULT_SPEAKER1        = '男生為節目主持人';
export const DEFAULT_SPEAKER2        = '女生為高師大的老師 Mary 老師（具教學經驗，說明清楚）';
export const DEFAULT_DIALOGUE_STYLE  = '採自然流暢的對話形式，具有節目感與互動感';
export const DEFAULT_TONE            = '語氣親切、易懂，適合一般聽眾';
export const DEFAULT_VOICE1          = 'Zephyr';
export const DEFAULT_VOICE2          = 'Puck';
export const DEFAULT_STYLE_ID        = 1;
export const DEFAULT_LYRICS_DURATION = 'Free style';

export const LYRICS_FREE_STYLE = 'Free style';
export const LYRICS_DURATIONS  = [
  'Free style', '30-second', '60-second', '90-second',
  '120-second', '150-second', '180-second',
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

export const LYRICS_PROMPT_FREE = (styleLabel: string) =>
  `幫我創作 ${styleLabel} 風格歌詞，並依照以下投影片內容順序編寫歌詞`;

export const LYRICS_PROMPT_TIMED = (styleLabel: string, totalSec: number, endTime: string) =>
  `幫我創作 ${styleLabel} 風格歌詞，總長度恰好 ${totalSec} 秒（結束時間 ${endTime}），並依照以下投影片內容順序編寫歌詞。

請使用時間軸格式輸出，精確標註每個段落的起訖時間，格式如下：

[0:00 - 0:10] Intro: 開場氛圍與樂器描述
[0:10 - 0:40] Verse 1: 歌詞內容...
[0:40 - 1:00] Chorus: 歌詞內容...
...
[最後段落的結束時間必須恰好為 ${endTime}，所有段落加總須等於 ${totalSec} 秒]`;

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
import { LYRICS_FREE_STYLE, PODCAST_PROMPT_TEMPLATE, LYRICS_PROMPT_FREE, LYRICS_PROMPT_TIMED } from './constants';

export function buildPodcastPrompt(vars: {
  speaker1: string; speaker2: string; dialogueStyle: string; tone: string;
}) {
  return PODCAST_PROMPT_TEMPLATE(vars);
}

export function buildLyricsPrompt(styleLabel: string, duration: string): string {
  if (duration === LYRICS_FREE_STYLE) return LYRICS_PROMPT_FREE(styleLabel);
  const totalSec = parseInt(duration);
  const mm = Math.floor(totalSec / 60);
  const ss = String(totalSec % 60).padStart(2, '0');
  return LYRICS_PROMPT_TIMED(styleLabel, totalSec, `${mm}:${ss}`);
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
    xml = xml.replace('</p:sld>', `<p:transition spd="med" advClick="1" advTm="${durationMs}"><p:fade/></p:transition></p:sld>`);
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
import { MODEL_TEXT, PARSE_PDF_PROMPT } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { pdf } = await req.json() as { pdf: string };
    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
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
import { MODEL_TEXT } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { slides, speaker1, speaker2, dialogueStyle, tone } = await req.json();
    const prompt = buildPodcastPrompt({ speaker1, speaker2, dialogueStyle, tone });
    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
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
import { MODEL_TEXT, DEFAULT_LYRICS_DURATION } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { script, styleId, duration = DEFAULT_LYRICS_DURATION } = await req.json();
    const styleLabel = MUSIC_STYLES.find(s => s.id === styleId)?.label ?? MUSIC_STYLES[0].label;
    const prompt = buildLyricsPrompt(styleLabel, duration);
    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
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
import { MODEL_TTS, DEFAULT_VOICE1, DEFAULT_VOICE2 } from '@/lib/constants';

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
    const { script, voice1 = DEFAULT_VOICE1, voice2 = DEFAULT_VOICE2 } = await req.json();
    const dialogue = extractDialogue(script);
    if (!dialogue) return NextResponse.json({ error: 'No dialogue lines found in script' }, { status: 400 });

    const response = await ai.models.generateContent({
      model: MODEL_TTS,
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

    // ⚠️ Server side 用 Buffer.from()，不要用 atob() 逐字元迴圈（大檔案會很慢）
    const pcmData = Buffer.from(audioData, 'base64');
    const wavData = pcmToWav(new Uint8Array(pcmData), sampleRate);

    return new NextResponse(wavData, {
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
import { MODEL_MUSIC } from '@/lib/constants';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { lyrics } = await req.json();
    const response = await ai.models.generateContent({
      model: MODEL_MUSIC,
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
  setPdfFile(file);
  setStep1State({ status: 'loading' });
  try {
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
**原因**：pdfjs-dist v5 是 ESM，webpack 打包時破壞模組初始化
**解法**：用 `webpackIgnore` 從 CDN 直接在執行期載入，完全繞過 webpack
```typescript
// ✅ 正確
const pdfjsLib = await import(/* webpackIgnore: true */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.min.mjs');

// ❌ 錯誤 — 會被 webpack 打包並崩潰
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

---

## 24. IndexedDB Schema

- **DB 名稱**：`podcast-generator`
- **Version**：1
- **Store**：`records`，keyPath: `id`
- **儲存**：所有 Blob（PDF、音訊、PPTX）可直接存入 IndexedDB，取出後型別為 Blob
- **還原 File**：`new File([rec.pdfBlob], rec.pdfName, { type: 'application/pdf' })`

---

## 25. 完整工作流程圖

```
使用者輸入 API Key（存 sessionStorage，關閉分頁清除）
    ↓
Step 0：設定說話者角色、TTS 聲音、歌曲風格、歌詞長度
    ↓
Step 1：上傳 PDF → FileReader base64 → /api/parse-pdf → Gemini 原生解析 → slides 文字
    ↓  建立 IndexedDB 紀錄（存 pdfBlob + 設定）
Step 2：/api/generate-script → Gemini → Podcast 對話文稿（含投影片標題行）
    ↓  updateRecord(script + speaker settings)
Step 3：/api/generate-lyrics → Gemini → AI 歌詞
    ↓  updateRecord(lyrics + style settings)
Step 4：/api/generate-podcast → extractDialogue → Gemini TTS → PCM→WAV
    ↓  updateRecord(podcastBlob + voice settings)
Step 5：/api/generate-music → Lyria → MP3
    ↓  updateRecord(musicBlob)
    ↓  [背景] calcPodcastTimings + calcMusicTimings → generatePptx × 2
        → updateRecord(podcastPptxBlob + musicPptxBlob)
    ↓
下載：script.txt / lyrics.txt / podcast.wav / music.mp3 / podcast_slides.pptx / music_slides.pptx
```

---

## 26. 已知限制

- Podcast 音訊為 WAV（未壓縮），檔案較大（~10-20MB）
- 歷史紀錄含所有 Blob，多筆後 IndexedDB 佔用空間可觀（每筆 30-50MB）
- PPTX 嵌入音訊後無法自動設定「跨投影片播放」，需使用者手動勾選
- CDN 載入 pdfjs 需要網路連線（首次 PPTX 生成時約 1MB 下載）
- TTS 多人語音使用 `gemini-2.5-flash-preview-tts`，預覽模型可能有 quota 限制
