'use client';

import { useState, useEffect, useRef } from 'react';
import { setUnauthorizedHandler, apiFetch } from '@/lib/apiFetch';
import LoginPage from '@/components/LoginPage';
import VideoExportBlock from '@/components/VideoExportBlock';
import SrtReviewPanel from '@/components/SrtReviewPanel';
import SrtCueEditor from '@/components/SrtCueEditor';
import { generatePptx } from '@/lib/generatePptx';
import { calcPodcastTimings, calcMusicTimings, normalizeTimings, getAudioDuration, shiftTimings, buildTransitionAdjustedTimings, buildSlideCueEvents, buildTimingsFromSlideCueEvents } from '@/lib/timing';
import { adjustSrtTimes, serializeSrtWithSlideTags } from '@/lib/srt';
import { saveRecord, updateRecord, getAllRecords, getRecordsByOwner, deleteRecord } from '@/lib/db';
import { clearAuthSession, isAuthEnabledClient, readStoredAuthSession, storeAuthSession, type AuthSession } from '@/lib/authClient';
import type { AlignMusicDiagnostics, AlignPodcastDiagnostics, ContentLanguage, GenerationRecord, NarrationMode, NarrationLengthPreset, StepState, SlideTimings, SrtEntry, SrtSlideCue, TtsGenerationMode, VisualCueTiming } from '@/lib/types';
import { MUSIC_STYLES, VOICES } from '@/lib/types';
import {
  AUTH_EMAIL_KEY, AUTH_TOKEN_KEY, SESSION_KEY,
  DEFAULT_SPEAKER1, DEFAULT_SPEAKER2, DEFAULT_DIALOGUE_STYLE, DEFAULT_TONE,
  DEFAULT_VOICE1, DEFAULT_VOICE2, DEFAULT_STYLE_ID, DEFAULT_LYRICS_DURATION,
  DEFAULT_TEXT_MODEL, DEFAULT_LOCAL_TEXT_MODEL, DEFAULT_MULTIMODAL_MODEL, DEFAULT_TTS_MODEL, DEFAULT_MUSIC_MODEL,
  TEXT_MODEL_OPTIONS, MULTIMODAL_MODEL_OPTIONS, TTS_MODEL_OPTIONS, MUSIC_MODEL_OPTIONS,
  resolveTextModelId, resolveStep41ModelId,
  LYRICS_DURATIONS, voiceSampleUrl,
  PODCAST_MAX_FILE_SIZE, MUSIC_MAX_FILE_SIZE, PODCAST_AUDIO_ACCEPT, MUSIC_AUDIO_ACCEPT,
  TTS_WARN_SEC, TTS_LONG_SEC, TTS_CHUNK_CHARS, CHUNK_GAP_MS,
  DEFAULT_CONTENT_LANGUAGE, CONTENT_LANGUAGE_OPTIONS,
  DEFAULT_NARRATION_LENGTH_PRESET, NARRATION_LENGTH_PRESETS,
  TRANSITION_COMPENSATION_SEC, MIN_VISIBLE_SLIDE_SEC,
} from '@/lib/constants';
import { estimateTtsDuration, estimateChunkCount } from '@/lib/ttsEstimate';

// ── helpers ──
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function downloadText(text: string, filename: string) {
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename);
}
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject; reader.readAsDataURL(blob);
  });
}

function fileHasExtension(file: File, extensions: string[]) {
  const fileName = file.name.toLowerCase();
  return extensions.some(ext => fileName.endsWith(ext));
}

function isPdfFile(file: File) {
  const mimeType = file.type.toLowerCase();
  return mimeType === 'application/pdf' ||
    mimeType === 'application/x-pdf' ||
    fileHasExtension(file, ['.pdf']);
}

const PDF_PARSE_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryablePdfParseError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return msg.includes('high demand') ||
    msg.includes('try again later') ||
    msg.includes('busy') ||
    msg.includes('overloaded') ||
    msg.includes('429') ||
    msg.includes('503');
}

function getPdfRetryDelayMs(attempt: number): number {
  return ([2000, 4000, 8000] as const)[attempt] ?? 8000;
}

function getAudioExtension(mimeType: string | undefined, fallback: string) {
  const normalized = (mimeType ?? '').toLowerCase();

  if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') return 'mp3';
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav' || normalized === 'audio/wave') return 'wav';
  if (normalized === 'audio/mp4' || normalized === 'audio/x-m4a' || normalized === 'audio/m4a') return 'm4a';
  if (normalized === 'audio/aac') return 'aac';

  return fallback;
}

function getAudioMimeType(file: File, fallback: string) {
  const normalized = file.type.toLowerCase();
  if (normalized) return normalized;

  if (fileHasExtension(file, ['.mp3'])) return 'audio/mpeg';
  if (fileHasExtension(file, ['.wav'])) return 'audio/wav';
  if (fileHasExtension(file, ['.m4a'])) return 'audio/mp4';
  if (fileHasExtension(file, ['.aac'])) return 'audio/aac';

  return fallback;
}

function getPodcastDownloadName(blob: Blob) {
  return `podcast.${getAudioExtension(blob.type, 'mp3')}`;
}

function formatTimeTag(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}${mm}${ss}`;
}

function buildTaggedName(base: string, tag: string | null, ext: string): string {
  return tag ? `${base}_${tag}.${ext}` : `${base}.${ext}`;
}

function getPodcastTag(scriptGeneratedAt?: number | null, createdAt?: number): string | null {
  if (scriptGeneratedAt) return formatTimeTag(scriptGeneratedAt);
  if (createdAt) return formatTimeTag(createdAt);
  return null;
}

function getMusicTag(lyricsGeneratedAt?: number | null, createdAt?: number): string | null {
  if (lyricsGeneratedAt) return formatTimeTag(lyricsGeneratedAt);
  if (createdAt) return formatTimeTag(createdAt);
  return null;
}

// ── theme tokens ──
function useTheme(dark: boolean) {
  return {
    page: dark ? 'bg-slate-900 text-slate-200' : 'bg-slate-100 text-slate-800',
    header: dark ? 'bg-slate-900/90 border-slate-700' : 'bg-white/90 border-slate-200',
    card: dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200',
    cardDone: dark ? 'bg-slate-800 border-emerald-700' : 'bg-white border-emerald-600',
    cardLoad: dark ? 'bg-slate-800 border-emerald-600' : 'bg-white border-emerald-500',
    cardErr: dark ? 'bg-slate-800 border-red-500' : 'bg-white border-red-400',
    inner: dark ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-100',
    input: dark ? 'bg-slate-900 border-slate-600 text-slate-200 placeholder:text-slate-600' : 'bg-white border-slate-200 text-slate-700 placeholder:text-slate-300',
    select: dark ? 'bg-slate-900 border-slate-600 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-700',
    label: dark ? 'text-slate-500' : 'text-slate-400',
    muted: dark ? 'text-slate-400' : 'text-slate-500',
    faint: dark ? 'text-slate-500' : 'text-slate-400',
    text: dark ? 'text-slate-200' : 'text-slate-700',
    heading: dark ? 'text-slate-100' : 'text-slate-800',
    green: dark ? 'text-emerald-400' : 'text-emerald-700',
    greenBg: dark ? 'bg-emerald-900/40 border-emerald-800' : 'bg-emerald-50 border-emerald-200',
    greenChip: dark ? 'bg-emerald-900/50 text-emerald-400 border-emerald-800' : 'bg-emerald-50 text-emerald-700 border-emerald-200',
    badge: dark ? 'bg-emerald-700 text-white' : 'bg-emerald-700 text-white',
    badgeLoad: dark ? 'bg-emerald-600 text-white' : 'bg-emerald-600 text-white',
    badgeErr: dark ? 'bg-red-600 text-white' : 'bg-red-500 text-white',
    badgeIdle: dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-500',
    mono: dark ? 'bg-slate-900 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-600',
    drawer: dark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-100',
    drawerItem: dark ? 'bg-slate-800 border-slate-700 hover:border-emerald-700' : 'bg-slate-50 border-slate-100 hover:border-emerald-300',
    dropzone: dark ? 'border-slate-600 hover:border-emerald-600 hover:bg-emerald-900/20' : 'border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40',
    dlBtn: (avail: boolean, load: boolean) =>
      avail ? (dark ? 'bg-slate-700 text-emerald-400 border-slate-600 hover:bg-emerald-700 hover:text-white hover:border-emerald-700'
        : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-700 hover:text-white hover:border-emerald-700')
        : load ? 'bg-amber-900/30 text-amber-400 border-amber-800/50 animate-pulse cursor-wait'
          : (dark ? 'bg-slate-800 text-slate-600 border-slate-700 cursor-not-allowed'
            : 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'),
  };
}

// ── StepCard ──
function StepCard({ step, title, state, children, disabled, dark }: {
  step: number; title: string; state: StepState;
  children: React.ReactNode; disabled?: boolean; dark: boolean;
}) {
  const t = useTheme(dark);
  const border =
    state.status === 'done' ? t.cardDone :
      state.status === 'loading' ? t.cardLoad :
        state.status === 'error' ? t.cardErr : t.card;
  const badge =
    state.status === 'done' ? t.badge :
      state.status === 'loading' ? t.badgeLoad :
        state.status === 'error' ? t.badgeErr : t.badgeIdle;

  return (
    <div className={`rounded-2xl border-2 ${border} shadow-sm p-5 transition-all duration-300 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex items-center gap-3 mb-4">
        <span className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold flex-shrink-0 ${badge}`}>
          {state.status === 'done' ? '✓' : step}
        </span>
        <h2 className={`text-sm font-bold ${t.heading}`} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {title}
        </h2>
        {state.status === 'loading' && (
          <span className={`ml-auto text-[11px] font-semibold ${t.green} flex items-center gap-1`}>
            <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin inline-block" />
            生成中...
          </span>
        )}
        {state.status === 'error' && (
          <span className="ml-auto text-[11px] text-red-400 font-semibold">錯誤</span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── LoadingBar ──
function LoadingBar({ message, dark }: { message: string; dark: boolean }) {
  return (
    <div className="space-y-1.5 py-1">
      <div className={`h-1 rounded-full overflow-hidden ${dark ? 'bg-slate-700' : 'bg-emerald-100'}`}>
        <div className="h-full w-3/5 bg-emerald-700 rounded-full animate-loading-bar" />
      </div>
      <p className={`text-[11px] font-medium ${dark ? 'text-emerald-400' : 'text-emerald-700'}`}>{message}</p>
    </div>
  );
}

// ── AudioPlayer ──
function AudioPlayer({ blob, label, dark }: { blob: Blob; label: string; dark: boolean }) {
  const [url] = useState(() => URL.createObjectURL(blob));
  return (
    <div className="space-y-1">
      <p className={`text-[11px] font-medium ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{label}</p>
      <audio controls src={url} className="w-full rounded-xl h-9" />
    </div>
  );
}

// ── TextBlock ──
function TextBlock({ text, dark, copyMode }: { text: string; dark: boolean; copyMode?: 'raw' | 'speaker-only' }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = useTheme(dark);

  function handleCopy() {
    const content = copyMode === 'speaker-only'
      ? text.split('\n').map(l => l.trim()).filter(Boolean).filter(l => /^speaker\b/i.test(l)).join('\n')
      : text;
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-1.5">
      <div className={`border rounded-xl p-3 text-[11px] font-mono whitespace-pre-wrap overflow-y-auto transition-all leading-relaxed ${t.mono} ${expanded ? 'max-h-[45vh]' : 'max-h-28'}`}>
        {text}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => setExpanded(e => !e)} className={`text-[11px] font-semibold ${t.green} hover:opacity-80`}>
          {expanded ? '↑ 收合' : '↓ 展開全文'}
        </button>
        <button onClick={handleCopy} className={`text-[11px] font-semibold transition-colors ${copied ? (dark ? 'text-emerald-400' : 'text-emerald-600') : (dark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-400 hover:text-slate-600')}`}>
          {copied ? '✓ 已複製' : '複製全文'}
        </button>
      </div>
    </div>
  );
}

// ── Toast ──
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed bottom-6 right-6 bg-emerald-800 text-white px-5 py-3 rounded-2xl shadow-xl z-50 text-xs font-medium animate-fade-in flex items-center gap-2">
      <span className="w-4 h-4 bg-white/20 rounded-full flex items-center justify-center text-[10px]">✓</span>
      {message}
    </div>
  );
}

// ── ActionBtn ──
function ActionBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="emerald-gradient text-white font-bold px-5 py-2 rounded-full text-xs shadow-md shadow-emerald-900/30 hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
      {children}
    </button>
  );
}

// ── DownloadChip ──
function DownloadChip({ label, onClick, dark }: { label: string; onClick: () => void; dark: boolean }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-all ${dark ? 'text-emerald-400 bg-emerald-900/30 border-emerald-800 hover:bg-emerald-800/60'
        : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
        }`}>
      <span style={{ fontSize: 12 }}>↓</span>{label}
    </button>
  );
}

// ── OffsetSelect ──
function OffsetSelect({ offset, onChange, dark }: { offset: number; onChange: (v: number) => void; dark: boolean }) {
  const options = [-1.0, -0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  return (
    <select
      value={offset}
      onChange={e => onChange(Number(e.target.value))}
      className={`ml-2 outline-none text-[10px] font-mono px-1 py-0.5 rounded border transition-all hover:opacity-80 cursor-pointer ${dark ? 'bg-slate-800 text-slate-300 border-slate-600' : 'bg-white text-slate-600 border-slate-300'}`}
      title="調整時間軸偏移量 (秒)"
    >
      {options.map(o => (
        <option key={o} value={o}>{o === 0 ? '不平移' : (o > 0 ? `+${o}s` : `${o}s`)}</option>
      ))}
    </select>
  );
}

// ═══════════════════════════════════════════
export default function Home() {
  type InputMode = 'api' | 'upload';
  type MediaSource = 'api' | 'upload';

  const authEnabled = isAuthEnabledClient();
  const [dark, setDark] = useState(true);
  const [authReady, setAuthReady] = useState(!authEnabled);
  const [authToken, setAuthToken] = useState('');
  const [authEmail, setAuthEmail] = useState('');

  const [apiKey, setApiKey] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [speaker1, setSpeaker1] = useState(DEFAULT_SPEAKER1);
  const [speaker2, setSpeaker2] = useState(DEFAULT_SPEAKER2);
  const [dialogueStyle, setDialogueStyle] = useState(DEFAULT_DIALOGUE_STYLE);
  const [tone, setTone] = useState(DEFAULT_TONE);
  const [voice1, setVoice1] = useState<string>(DEFAULT_VOICE1);
  const [voice2, setVoice2] = useState<string>(DEFAULT_VOICE2);
  const [narrationMode, setNarrationMode] = useState<NarrationMode>('duo');
  const [contentLanguage, setContentLanguage] = useState<ContentLanguage>(DEFAULT_CONTENT_LANGUAGE);
  const [narrationLengthPreset, setNarrationLengthPreset] = useState<NarrationLengthPreset>(DEFAULT_NARRATION_LENGTH_PRESET);
  const [narrationLengthNote, setNarrationLengthNote] = useState('');
  const [audioTagsEnabled, setAudioTagsEnabled] = useState(false);
  const [multimodalModel, setMultimodalModel] = useState<string>(DEFAULT_MULTIMODAL_MODEL);
  const [textModel, setTextModel] = useState<string>(DEFAULT_TEXT_MODEL);
  const [localLlmEnabled, setLocalLlmEnabled] = useState(false);
  const [localLlmLabel, setLocalLlmLabel] = useState('Gemma 4');
  const [ttsModel, setTtsModel] = useState<string>(DEFAULT_TTS_MODEL);
  const [musicModel, setMusicModel] = useState<string>(DEFAULT_MUSIC_MODEL);
  const [styleId, setStyleId] = useState(DEFAULT_STYLE_ID);
  const [lyricsDuration, setLyricsDuration] = useState(DEFAULT_LYRICS_DURATION);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [slides, setSlides] = useState('');
  const [script, setScript] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [podcastBlob, setPodcastBlob] = useState<Blob | null>(null);
  const [musicBlob, setMusicBlob] = useState<Blob | null>(null);
  const [podcastInputMode, setPodcastInputMode] = useState<InputMode>('api');
  const [podcastSource, setPodcastSource] = useState<MediaSource>('api');
  const [musicInputMode, setMusicInputMode] = useState<InputMode>('api');
  const [musicSource, setMusicSource] = useState<MediaSource>('api');
  const [podcastPptxBlob, setPodcastPptxBlob] = useState<Blob | null>(null);
  const [musicPptxBlob, setMusicPptxBlob] = useState<Blob | null>(null);
  const [podcastSrt, setPodcastSrt] = useState<string>('');
  const [musicSrt, setMusicSrt] = useState<string>('');
  const [podcastDiagnostics, setPodcastDiagnostics] = useState<AlignPodcastDiagnostics | null>(null);
  const [musicDiagnostics, setMusicDiagnostics] = useState<AlignMusicDiagnostics | null>(null);
  const [podcastSrtOffset, setPodcastSrtOffset] = useState<number>(0);
  const [musicSrtOffset, setMusicSrtOffset] = useState<number>(0);
  const [podcastTimings, setPodcastTimings] = useState<SlideTimings | null>(null);
  const [musicTimings, setMusicTimings] = useState<SlideTimings | null>(null);
  const [musicVisualCueTimings, setMusicVisualCueTimings] = useState<VisualCueTiming[] | null>(null);
  const [podcastSrtEntries, setPodcastSrtEntries] = useState<SrtEntry[]>([]);
  const [musicSrtEntries, setMusicSrtEntries] = useState<SrtEntry[]>([]);
  const [podcastSlideCues, setPodcastSlideCues] = useState<SrtSlideCue[]>([]);
  const [musicSlideCues, setMusicSlideCues] = useState<SrtSlideCue[]>([]);
  const [podcastSrtConfirmed, setPodcastSrtConfirmed] = useState(false);
  const [musicSrtConfirmed, setMusicSrtConfirmed] = useState(false);
  const [podcastVideoBlob, setPodcastVideoBlob] = useState<Blob | null>(null);
  const [musicVideoBlob, setMusicVideoBlob] = useState<Blob | null>(null);
  const [podcastVideoFilename, setPodcastVideoFilename] = useState<string | null>(null);
  const [musicVideoFilename, setMusicVideoFilename] = useState<string | null>(null);
  const [scriptGeneratedAt, setScriptGeneratedAt] = useState<number | null>(null);
  const [lyricsGeneratedAt, setLyricsGeneratedAt] = useState<number | null>(null);
  const [lyricsContentSource, setLyricsContentSource] = useState<'script' | 'slides'>('script');
  const [step1State, setStep1State] = useState<StepState>({ status: 'idle' });
  const [step1LoadingMsg, setStep1LoadingMsg] = useState('正在解析 PDF 投影片...');
  const [step2State, setStep2State] = useState<StepState>({ status: 'idle' });
  const [step3State, setStep3State] = useState<StepState>({ status: 'idle' });
  const [step4State, setStep4State] = useState<StepState>({ status: 'idle' });
  const [step5State, setStep5State] = useState<StepState>({ status: 'idle' });
  const [step6State, setStep6State] = useState<StepState>({ status: 'idle' });
  const [step7State, setStep7State] = useState<StepState>({ status: 'idle' });
  const [pptxLoading, setPptxLoading] = useState(false);
  const [videoExportEnabled, setVideoExportEnabled] = useState(false);
  const [ttsChunkingEnabled, setTtsChunkingEnabled] = useState(false);
  const [ttsGenerationMode, setTtsGenerationMode] = useState<TtsGenerationMode>('single');
  const [toast, setToast] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [recordId, setRecordId] = useState('');
  const [dragging, setDragging] = useState(false);
  const [isEditingScript, setIsEditingScript] = useState(false);
  const [scriptDraft, setScriptDraft] = useState('');
  const [isEditingLyrics, setIsEditingLyrics] = useState(false);
  const [lyricsDraft, setLyricsDraft] = useState('');

  const step2Ref = useRef<HTMLDivElement>(null);
  const step3Ref = useRef<HTMLDivElement>(null);
  const step4Ref = useRef<HTMLDivElement>(null);
  const step5Ref = useRef<HTMLDivElement>(null);
  const step6Ref = useRef<HTMLDivElement>(null);
  const step7Ref = useRef<HTMLDivElement>(null);
  const pdfUploadInputRef = useRef<HTMLInputElement>(null);
  const podcastUploadInputRef = useRef<HTMLInputElement>(null);
  const musicUploadInputRef = useRef<HTMLInputElement>(null);

  const t = useTheme(dark);
  const normalizedOwnerEmail = authEnabled ? authEmail.trim().toLowerCase() : undefined;

  const podcastSrtForDownload = podcastSlideCues.length > 0 && podcastSrtEntries.length > 0
    ? serializeSrtWithSlideTags(podcastSrtEntries, podcastSlideCues)
    : podcastSrt;
  const musicSrtForDownload = musicSlideCues.length > 0 && musicSrtEntries.length > 0
    ? serializeSrtWithSlideTags(musicSrtEntries, musicSlideCues)
    : musicSrt;
  const isDuo = narrationMode === 'duo';
  const textModelOptions = localLlmEnabled
    ? TEXT_MODEL_OPTIONS.map(option => option.id === DEFAULT_LOCAL_TEXT_MODEL
      ? { ...option, label: localLlmLabel }
      : option)
    : TEXT_MODEL_OPTIONS.filter(option => option.id !== DEFAULT_LOCAL_TEXT_MODEL);

  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) { setApiKey(saved); setApiKeyInput(saved); }

    if (authEnabled) {
      const session = readStoredAuthSession();
      if (session) {
        setAuthToken(session.token);
        setAuthEmail(session.email);
      }
    }

    setUnauthorizedHandler((kind) => {
      if (kind === 'auth') {
        clearAuthSession();
        setAuthToken('');
        setAuthEmail('');
        setToast('登入已失效，請重新驗證');
        return;
      }

      setApiKey('');
      setApiKeyInput('');
      setToast('API Key 無效，請重新輸入');
    });

    setAuthReady(true);
  }, [authEnabled]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/runtime-config', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as { localLlmEnabled?: boolean; localLlmLabel?: string; videoExportEnabled?: boolean; ttsChunkingEnabled?: boolean };
        const enabled = Boolean(data.localLlmEnabled);
        const label = data.localLlmLabel?.trim() || 'Gemma 4';
        setLocalLlmEnabled(enabled);
        setLocalLlmLabel(label);
        setVideoExportEnabled(Boolean(data.videoExportEnabled));
        setTtsChunkingEnabled(Boolean(data.ttsChunkingEnabled));
        setTextModel(prev => !enabled && resolveTextModelId(prev) === DEFAULT_LOCAL_TEXT_MODEL
          ? DEFAULT_TEXT_MODEL
          : resolveTextModelId(prev));
        setMultimodalModel(prev => resolveStep41ModelId(prev));
      } catch {
        setLocalLlmEnabled(false);
        setLocalLlmLabel('Gemma 4');
        setTextModel(prev => resolveTextModelId(prev) === DEFAULT_LOCAL_TEXT_MODEL ? DEFAULT_TEXT_MODEL : resolveTextModelId(prev));
        setMultimodalModel(prev => resolveStep41ModelId(prev));
      }
    })();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    void (async () => {
      if (authEnabled) {
        if (!authEmail) {
          setHistory([]);
          return;
        }
        setHistory(await getRecordsByOwner(authEmail));
        return;
      }

      setHistory(await getAllRecords());
    })();
  }, [authEnabled, authEmail, authReady]);

  useEffect(() => {
    if (!podcastVideoBlob) {
      setPodcastVideoFilename(null);
    }
  }, [podcastVideoBlob]);

  useEffect(() => {
    if (!musicVideoBlob) {
      setMusicVideoFilename(null);
    }
  }, [musicVideoBlob]);

  async function loadHistory() {
    if (authEnabled) {
      if (!authEmail) {
        setHistory([]);
        return;
      }
      setHistory(await getRecordsByOwner(authEmail));
      return;
    }

    setHistory(await getAllRecords());
  }

  function saveApiKey() {
    const key = apiKeyInput.trim(); if (!key) return;
    sessionStorage.setItem(SESSION_KEY, key); setApiKey(key); setToast('API Key 已儲存');
  }
  function clearApiKey() {
    sessionStorage.removeItem(SESSION_KEY); setApiKey(''); setApiKeyInput(''); setToast('API Key 已清除');
  }

  function handleLoginSuccess(session: AuthSession) {
    storeAuthSession(session.token, session.email);
    setAuthToken(session.token);
    setAuthEmail(session.email);
    setToast('登入成功，已進入 DeckCast 工作台');
  }

  function handleLogout() {
    clearAuthSession();
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_EMAIL_KEY);
    setAuthToken('');
    setAuthEmail('');
    setHistory([]);
    setDrawerOpen(false);
    handleNewProject();
    setToast('已登出，請重新完成驗證');
  }

  function resetPodcastDerivedState() {
    setPodcastPptxBlob(null);
    setPodcastSrt('');
    setPodcastDiagnostics(null);
    setStep4State({ status: 'idle' });
    setPodcastTimings(null);
    setPodcastSrtOffset(0);
    setPodcastVideoBlob(null);
    setPodcastSrtEntries([]);
    setPodcastSlideCues([]);
    setPodcastSrtConfirmed(false);
    if (recordId) {
      void updateRecord(recordId, {
        podcastPptxBlob: undefined,
        podcastSrt: undefined,
        podcastDiagnostics: undefined,
        podcastTimings: undefined,
        podcastSrtEntries: undefined,
        podcastSlideCues: undefined,
        podcastSrtConfirmed: undefined,
      }, normalizedOwnerEmail);
    }
  }

  function resetMusicDerivedState() {
    setMusicPptxBlob(null);
    setMusicSrt('');
    setMusicDiagnostics(null);
    setStep7State({ status: 'idle' });
    setMusicTimings(null);
    setMusicVisualCueTimings(null);
    setMusicSrtOffset(0);
    setMusicVideoBlob(null);
    setMusicSrtEntries([]);
    setMusicSlideCues([]);
    setMusicSrtConfirmed(false);
    if (recordId) {
      void updateRecord(recordId, {
        musicPptxBlob: undefined,
        musicSrt: undefined,
        musicDiagnostics: undefined,
        musicTimings: undefined,
        musicSrtEntries: undefined,
        musicSlideCues: undefined,
        musicSrtConfirmed: undefined,
      }, normalizedOwnerEmail);
    }
  }

  function handleStartScriptEdit() {
    setScriptDraft(script);
    setIsEditingScript(true);
  }

  function handleCancelScriptEdit() {
    setIsEditingScript(false);
    setScriptDraft('');
  }

  async function handleSaveScriptEdit() {
    const nextScript = scriptDraft.trim();
    if (!nextScript) return;

    const now = Date.now();

    setScript(nextScript);
    setScriptGeneratedAt(now);
    setIsEditingScript(false);
    setScriptDraft('');

    // 清除 Podcast 下游
    resetPodcastDerivedState();
    setPodcastBlob(null);
    setStep3State({ status: 'idle' });
    setStep4State({ status: 'idle' });

    // 所有模式都清歌詞 / 音樂鏈（Step 5 歌詞來源統一為 script）
    resetMusicDerivedState();
    setLyrics('');
    setLyricsGeneratedAt(null);
    setMusicBlob(null);
    setIsEditingLyrics(false);
    setLyricsDraft('');
    setStep5State({ status: 'idle' });
    setStep6State({ status: 'idle' });
    setStep7State({ status: 'idle' });

    if (recordId) {
      await updateRecord(recordId, {
        script: nextScript,
        scriptGeneratedAt: now,
        podcastBlob: undefined,
        podcastPptxBlob: undefined,
        podcastSrt: undefined,
        podcastTimings: undefined,
        podcastDiagnostics: undefined,
        podcastVideoBlob: undefined,
        lyrics: undefined,
        lyricsGeneratedAt: undefined,
        musicBlob: undefined,
        musicSource: undefined,
        musicPptxBlob: undefined,
        musicSrt: undefined,
        musicTimings: undefined,
        musicDiagnostics: undefined,
        musicVideoBlob: undefined,
      }, normalizedOwnerEmail);
    }
  }

  function handleStartLyricsEdit() {
    setLyricsDraft(lyrics);
    setIsEditingLyrics(true);
  }

  function handleCancelLyricsEdit() {
    setIsEditingLyrics(false);
    setLyricsDraft('');
  }

  async function handleSaveLyricsEdit() {
    const nextLyrics = lyricsDraft.trim();
    if (!nextLyrics) return;

    const now = Date.now();

    setLyrics(lyricsDraft);
    setLyricsGeneratedAt(now);
    setIsEditingLyrics(false);
    setLyricsDraft('');

    setMusicBlob(null);
    setStep6State({ status: 'idle' });
    resetMusicDerivedState();

    if (recordId) {
      await updateRecord(recordId, {
        lyrics: lyricsDraft,
        lyricsGeneratedAt: now,
        musicBlob: undefined,
        musicSource: undefined,
        musicPptxBlob: undefined,
        musicSrt: undefined,
        musicTimings: undefined,
        musicDiagnostics: undefined,
        musicVideoBlob: undefined,
      }, normalizedOwnerEmail);
    }
  }

  function isMp3File(file: File) {
    const fileName = file.name.toLowerCase();
    return file.type === 'audio/mpeg' || file.type === 'audio/mp3' || fileName.endsWith('.mp3');
  }

  function isPodcastAudioFile(file: File) {
    if (isMp3File(file)) return true;

    const mimeType = file.type.toLowerCase();
    return mimeType === 'audio/wav' ||
      mimeType === 'audio/x-wav' ||
      mimeType === 'audio/wave' ||
      mimeType === 'audio/mp4' ||
      mimeType === 'audio/x-m4a' ||
      mimeType === 'audio/m4a' ||
      mimeType === 'audio/aac' ||
      fileHasExtension(file, ['.wav', '.m4a', '.aac']);
  }

  function resetPdfInput() {
    if (pdfUploadInputRef.current) {
      pdfUploadInputRef.current.value = '';
    }
  }

  function openPdfPicker() {
    if (step1State.status === 'loading') return;
    resetPdfInput();
    pdfUploadInputRef.current?.click();
  }

  async function parsePdfOnce(pdfBase64: string): Promise<string> {
    const res = await apiFetch('/api/parse-pdf', { pdf: pdfBase64, multimodalModel });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json() as { slides: string };
    return data.slides;
  }

  async function parsePdfWithRetry(pdfBase64: string): Promise<string> {
    let lastError: unknown = new Error('不明錯誤');
    for (let attempt = 0; attempt <= PDF_PARSE_MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          setStep1LoadingMsg(`正在重新解析 PDF 投影片（${attempt}/${PDF_PARSE_MAX_RETRIES}）...`);
        }
        return await parsePdfOnce(pdfBase64);
      } catch (e) {
        lastError = e;
        if (attempt < PDF_PARSE_MAX_RETRIES && isRetryablePdfParseError(e)) {
          const delayMs = getPdfRetryDelayMs(attempt);
          const delaySec = delayMs / 1000;
          setStep1LoadingMsg(`模型繁忙，${delaySec} 秒後自動重試（${attempt + 1}/${PDF_PARSE_MAX_RETRIES}）`);
          setToast(`模型繁忙，自動重試中（${attempt + 1}/${PDF_PARSE_MAX_RETRIES}）`);
          await sleep(delayMs);
        } else {
          throw e;
        }
      }
    }
    throw lastError;
  }

  async function handlePdfUpload(file: File) {
    if (!apiKey) { setToast('請先填入 Gemini API Key'); return; }

    if (!isPdfFile(file)) {
      const msg = '上傳檔案必須為 pdf';
      setStep1State({ status: 'error', error: msg });
      setToast(msg);
      resetPdfInput();
      return;
    }

    setPdfFile(file);
    setStep1State({ status: 'loading' });
    setStep1LoadingMsg('正在解析 PDF 投影片...');
    try {
      // @ts-expect-error: bypass remote https import typing
      const pdfjsLib = await import(/* webpackIgnore: true */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.worker.min.mjs';
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      if (pdfDoc.numPages < 3 || pdfDoc.numPages > 25) {
        const msg = '請上傳 3-25 頁的範圍簡報檔案';
        setStep1State({ status: 'error', error: msg });
        setToast(msg);
        return;
      }

      const pdfBase64 = await blobToBase64(file);
      const slidesResult = await parsePdfWithRetry(pdfBase64);
      setSlides(slidesResult);
      setStep1State({ status: 'done' });
      const id = `${Date.now()}`; setRecordId(id);
      await saveRecord({
        id,
        pdfName: file.name,
        createdAt: Date.now(),
        ownerEmail: normalizedOwnerEmail,
        contentLanguage,
        narrationMode,
        narrationLengthPreset,
        narrationLengthNote,
        speaker1,
        speaker2,
        dialogueStyle,
        tone,
        voice1,
        voice2,
        multimodalModel,
        textModel,
        step41Model: multimodalModel,
        step42Model: textModel,
        step71Model: multimodalModel,
        step72Model: textModel,
        ttsModel,
        musicModel,
        styleId,
        lyricsDuration,
        audioTagsEnabled,
        musicStyle: MUSIC_STYLES.find(s => s.id === styleId)?.label ?? '',
        slides: slidesResult,
        pdfBlob: file,
      });
      loadHistory();
      setTimeout(() => step2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) {
      setStep1State({ status: 'error', error: String(e) });
      setToast('PDF 解析失敗：' + String(e));
    } finally {
      resetPdfInput();
      setStep1LoadingMsg('正在解析 PDF 投影片...');
    }
  }

  async function handleGenerateScript() {
    if (!slides) return; setStep2State({ status: 'loading' });
    try {
      const res = await apiFetch('/api/generate-script', {
        slides,
        narrationMode,
        speaker1: speaker1 || DEFAULT_SPEAKER1,
        speaker2: speaker2 || DEFAULT_SPEAKER2,
        dialogueStyle: dialogueStyle || DEFAULT_DIALOGUE_STYLE,
        tone: tone || DEFAULT_TONE,
        textModel,
        contentLanguage,
        narrationLengthPreset,
        narrationLengthNote,
        audioTagsEnabled,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const now = Date.now();
      setScript(data.script); setScriptGeneratedAt(now); setStep2State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { script: data.script, scriptGeneratedAt: now, narrationMode, speaker1, speaker2, dialogueStyle, tone, textModel, contentLanguage, narrationLengthPreset, narrationLengthNote, audioTagsEnabled }, normalizedOwnerEmail);
      setTimeout(() => step3Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) { setStep2State({ status: 'error', error: String(e) }); setToast('文稿生成失敗：' + String(e)); }
  }

  async function handleGeneratePodcast() {
    if (!script) return; setStep3State({ status: 'loading' });
    try {
      setPodcastInputMode('api');
      const res = await apiFetch('/api/generate-podcast', { script, voice1, voice2, ttsModel, narrationMode, contentLanguage, ttsGenerationMode });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      resetPodcastDerivedState();
      setPodcastBlob(blob);
      setPodcastSource('api');
      setStep3State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { podcastBlob: blob, podcastSource: 'api', voice1, voice2, ttsModel, contentLanguage }, normalizedOwnerEmail);
      setTimeout(() => step4Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) { setStep3State({ status: 'error', error: String(e) }); setToast('Podcast 音訊生成失敗：' + String(e)); }
  }

  async function handlePodcastUpload(file: File) {
    if (!isPodcastAudioFile(file)) {
      const msg = '請上傳 mp3、wav、m4a 或 aac 音訊檔案';
      setStep3State({ status: 'error', error: msg });
      setToast(msg);
      return;
    }

    if (file.size > PODCAST_MAX_FILE_SIZE) {
      const msg = '檔案太大，請保持在 50MB 以內';
      setStep3State({ status: 'error', error: msg });
      setToast(msg);
      return;
    }

    setStep3State({ status: 'loading' });
    try {
      const blob = new Blob([await file.arrayBuffer()], { type: getAudioMimeType(file, 'audio/mpeg') });
      setPodcastInputMode('upload');
      resetPodcastDerivedState();
      setPodcastBlob(blob);
      setPodcastSource('upload');
      setStep3State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { podcastBlob: blob, podcastSource: 'upload', contentLanguage }, normalizedOwnerEmail);
      setToast(`已上傳音訊：${file.name}`);
      setTimeout(() => step4Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) {
      setStep3State({ status: 'error', error: String(e) });
      setToast('音訊上傳失敗：' + String(e));
    }
  }

  async function handleRepackPodcastPptx() {
    if (!podcastBlob || !pdfFile || !Array.isArray(podcastTimings)) return;
    setStep4State({ status: 'loading' });
    try {
      const appliedOffset = podcastSrtOffset;
      const newTimings = shiftTimings(podcastTimings, appliedOffset);
      const adjustedSrt = adjustSrtTimes(podcastSrt, appliedOffset);
      const adjustedTimings = buildTransitionAdjustedTimings(newTimings, TRANSITION_COMPENSATION_SEC, MIN_VISIBLE_SLIDE_SEC);
      const pptx = await generatePptx(pdfFile, adjustedTimings, podcastBlob);
      setPodcastTimings(newTimings);
      setPodcastSrt(adjustedSrt);
      setPodcastSrtOffset(0);
      setPodcastVideoBlob(null);
      setPodcastPptxBlob(pptx);
      setStep4State({ status: 'done' });
      if (recordId) await updateRecord(recordId, {
        podcastPptxBlob: pptx,
        podcastTimings: newTimings,
        podcastSrt: adjustedSrt,
        contentLanguage,
      }, normalizedOwnerEmail);
      setToast(`已套用平移 (${appliedOffset > 0 ? '+' : ''}${appliedOffset}s) 並重新封裝 Podcast 簡報！`);
    } catch (e) {
      setStep4State({ status: 'error', error: String(e) });
      setToast('重封裝失敗：' + String(e));
    }
  }

  async function handleRepackMusicPptx() {
    if (!musicBlob || !pdfFile || !Array.isArray(musicTimings)) return;
    setStep7State({ status: 'loading' });
    try {
      const appliedOffset = musicSrtOffset;
      const newTimings = shiftTimings(musicTimings, appliedOffset);
      const adjustedSrt = adjustSrtTimes(musicSrt, appliedOffset);
      const adjustedTimings = buildTransitionAdjustedTimings(newTimings, TRANSITION_COMPENSATION_SEC, MIN_VISIBLE_SLIDE_SEC);
      const pptx = await generatePptx(pdfFile, adjustedTimings, musicBlob);
      setMusicTimings(newTimings);
      setMusicSrt(adjustedSrt);
      setMusicSrtOffset(0);
      setMusicVideoBlob(null);
      setMusicPptxBlob(pptx);
      setStep7State({ status: 'done' });
      if (recordId) await updateRecord(recordId, {
        musicPptxBlob: pptx,
        musicTimings: newTimings,
        musicSrt: adjustedSrt,
        contentLanguage,
      }, normalizedOwnerEmail);
      setToast(`已套用平移 (${appliedOffset > 0 ? '+' : ''}${appliedOffset}s) 並重新封裝歌曲簡報！`);
    } catch (e) {
      setStep7State({ status: 'error', error: String(e) });
      setToast('重封裝失敗：' + String(e));
    }
  }

  async function runAlignPodcast() {
    if (!podcastBlob || !script || !pdfFile) return;
    setPodcastVideoBlob(null);
    setPodcastSrtConfirmed(false);
    setPodcastPptxBlob(null);
    setStep4State({ status: 'loading' });
    try {
      const slideCount = (slides.match(/投影片\s*\d+/g) ?? []).length || 3;
      const audioBase64 = await blobToBase64(podcastBlob);
      const duration = await getAudioDuration(podcastBlob);

      const res = await apiFetch('/api/align-podcast', {
        script,
        audioBase64,
        audioMimeType: podcastBlob.type || 'audio/mpeg',
        textModel,
        step41Model: multimodalModel,
        step42Model: textModel,
        contentLanguage,
      });
      let timings;
      let srt = '';
      let diagnostics: AlignPodcastDiagnostics | null = null;
      let newSrtEntries: SrtEntry[] = [];
      let newSlideCues: SrtSlideCue[] = [];
      if (res.ok) {
        const data = await res.json();
        diagnostics = data.diagnostics ?? null;
        timings = normalizeTimings(data.timings, slideCount, duration);
        srt = data.srt ?? '';
        newSrtEntries = Array.isArray(data.srtEntries) ? data.srtEntries : [];
        newSlideCues = Array.isArray(data.slideCues) ? data.slideCues : [];
      } else {
        console.warn('API align-podcast failed, falling back to heuristic calculation.', await res.text());
        timings = await calcPodcastTimings(script, slideCount, podcastBlob);
        // Heuristic path: no SRT entries to review — confirm immediately and build PPTX
        setPodcastTimings(timings);
        setPodcastSrtConfirmed(true);
        if (recordId) {
          await updateRecord(recordId, {
            podcastTimings: timings,
            podcastSrtConfirmed: true,
            multimodalModel, textModel, step41Model: multimodalModel, step42Model: textModel, contentLanguage,
          }, normalizedOwnerEmail);
        }
        setStep4State({ status: 'done' });
        await buildPodcastPptxFromConfirmedSrt(timings);
        return;
      }

      setPodcastSrtEntries(newSrtEntries);
      setPodcastSlideCues(newSlideCues);
      setPodcastSrt(srt);
      setPodcastDiagnostics(diagnostics);
      setPodcastTimings(timings);
      setStep4State({ status: 'done' });

      if (recordId) {
        await updateRecord(recordId, {
          podcastSrt: srt,
          podcastDiagnostics: diagnostics ?? undefined,
          podcastTimings: timings,
          podcastSrtEntries: newSrtEntries,
          podcastSlideCues: newSlideCues,
          podcastSrtConfirmed: false,
          multimodalModel,
          textModel,
          step41Model: multimodalModel,
          step42Model: textModel,
          contentLanguage,
        }, normalizedOwnerEmail);
      }
      setToast('SRT 對齊完成，請確認字幕時間後繼續。');
    } catch (e) {
      setStep4State({ status: 'error', error: String(e) }); setToast('Podcast 對齊失敗：' + String(e));
    }
  }

  async function handleGeneratePodcastPptx() {
    if (!podcastBlob || !script || !pdfFile) return;
    if (!podcastSrtConfirmed) {
      await runAlignPodcast();
      return;
    }
    await buildPodcastPptxFromConfirmedSrt();
  }

  async function buildPodcastPptxFromConfirmedSrt(freshTimings?: SlideTimings) {
    if (!podcastBlob || !script || !pdfFile) return;
    setPodcastVideoBlob(null);
    setStep4State({ status: 'loading' });
    try {
      const slideCount = (slides.match(/投影片\s*\d+/g) ?? []).length || 3;
      const duration = await getAudioDuration(podcastBlob);
      // Derive timings from cues when available — this gives the correct frame count
      // matching the SRT slide tags. Only fall back to freshTimings / stored timings
      // (which are normalizeTimings output with length=slideCount) when there are no cues.
      let timings: SlideTimings;
      if (podcastSlideCues.length > 0 && podcastSrtEntries.length > 0) {
        const events = buildSlideCueEvents(podcastSlideCues, podcastSrtEntries);
        timings = events.length > 0
          ? buildTimingsFromSlideCueEvents(events, duration)
          : normalizeTimings([], slideCount, duration);
      } else {
        const raw = freshTimings ?? podcastTimings ?? null;
        timings = Array.isArray(raw) ? raw : normalizeTimings([], slideCount, duration);
      }
      // Sync state so VideoExportBlock receives the cue-derived timings (length = cue count,
      // not PDF page count), ensuring PPTX and MP4 frame counts stay identical.
      setPodcastTimings(timings);
      const adjustedTimings = buildTransitionAdjustedTimings(timings, TRANSITION_COMPENSATION_SEC, MIN_VISIBLE_SLIDE_SEC);
      const pptx = await generatePptx(pdfFile, adjustedTimings, podcastBlob);
      setPodcastPptxBlob(pptx);
      setStep4State({ status: 'done' });
      if (recordId) {
        await updateRecord(recordId, {
          podcastPptxBlob: pptx,
          podcastSrtConfirmed: true,
        }, normalizedOwnerEmail);
      }
      setToast('Podcast 簡報已生成！'); loadHistory();
      setTimeout(() => step5Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) {
      setStep4State({ status: 'error', error: String(e) }); setToast('Podcast 簡報生成失敗：' + String(e));
    }
  }

  async function handleConfirmPodcastSrt() {
    setPodcastSrtConfirmed(true);
    if (recordId) {
      await updateRecord(recordId, { podcastSrtConfirmed: true }, normalizedOwnerEmail);
    }
    await buildPodcastPptxFromConfirmedSrt();
  }

  async function handleLyricsContentSourceChange(nextSource: 'script' | 'slides') {
    if (nextSource === lyricsContentSource) return;
    setLyricsContentSource(nextSource);
    const hasGeneratedLyrics = !!lyrics;
    const hasMusicChain = !!musicBlob || !!musicPptxBlob || !!musicSrt || !!musicTimings || !!musicVideoBlob;
    if (!hasGeneratedLyrics && !hasMusicChain) {
      if (recordId) await updateRecord(recordId, { lyricsContentSource: nextSource }, normalizedOwnerEmail);
      return;
    }
    setLyrics(''); setLyricsGeneratedAt(null);
    setStep5State({ status: 'idle' });
    setIsEditingLyrics(false); setLyricsDraft('');
    setMusicBlob(null); setStep6State({ status: 'idle' });
    setMusicPptxBlob(null); setMusicSrt(''); setMusicDiagnostics(null);
    setStep7State({ status: 'idle' }); setMusicTimings(null); setMusicVisualCueTimings(null);
    setMusicSrtOffset(0); setMusicVideoBlob(null);
    if (recordId) {
      await updateRecord(recordId, {
        lyricsContentSource: nextSource,
        lyrics: undefined, lyricsGeneratedAt: undefined,
        musicBlob: undefined, musicSource: undefined, musicPptxBlob: undefined,
        musicSrt: undefined, musicTimings: undefined, musicDiagnostics: undefined, musicVideoBlob: undefined,
      }, normalizedOwnerEmail);
    }
    setToast('已切換歌詞內容依據，請重新生成歌詞。');
  }

  async function handleGenerateLyrics() {
    const hasSource = lyricsContentSource === 'slides' ? !!slides : !!script;
    if (!hasSource) return; setStep5State({ status: 'loading' });
    try {
      const lyricsSourceText = lyricsContentSource === 'slides' ? slides : script;
      const res = await apiFetch('/api/generate-lyrics', { script, lyricsSource: lyricsSourceText, styleId, duration: lyricsDuration, textModel, contentLanguage });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const now = Date.now();
      setLyrics(data.lyrics); setLyricsGeneratedAt(now); setStep5State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { lyrics: data.lyrics, lyricsGeneratedAt: now, lyricsContentSource, styleId, lyricsDuration, musicStyle: MUSIC_STYLES.find(s => s.id === styleId)?.label ?? '', textModel, contentLanguage }, normalizedOwnerEmail);
      setTimeout(() => step6Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) { setStep5State({ status: 'error', error: String(e) }); setToast('歌詞生成失敗：' + String(e)); }
  }

  async function handleGenerateMusic() {
    if (!lyrics) return; setStep6State({ status: 'loading' });
    try {
      setMusicInputMode('api');
      const res = await apiFetch('/api/generate-music', { lyrics, styleId, duration: lyricsDuration, musicModel, contentLanguage });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      resetMusicDerivedState();
      setMusicBlob(blob);
      setMusicSource('api');
      setStep6State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { musicBlob: blob, musicSource: 'api', musicModel, contentLanguage }, normalizedOwnerEmail);
      setTimeout(() => step7Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) {
      const msg = String(e); const isBlocked = msg.includes('PROHIBITED_CONTENT');
      setStep6State({ status: 'error', error: isBlocked ? 'PROHIBITED_CONTENT：歌詞觸發內容審核，請重新生成歌詞後再試' : msg });
      setToast(isBlocked ? '歌詞觸發內容審核，請重新生成歌詞' : '音樂生成失敗：' + msg);
    }
  }

  async function handleMusicUpload(file: File) {
    if (!isMp3File(file)) {
      const msg = '請上傳 mp3 音樂檔案';
      setStep6State({ status: 'error', error: msg });
      setToast(msg);
      return;
    }

    if (file.size > MUSIC_MAX_FILE_SIZE) {
      const msg = '檔案太大，請保持在 20MB 以內';
      setStep6State({ status: 'error', error: msg });
      setToast(msg);
      return;
    }

    setStep6State({ status: 'loading' });
    try {
      const blob = new Blob([await file.arrayBuffer()], { type: 'audio/mpeg' });
      setMusicInputMode('upload');
      resetMusicDerivedState();
      setMusicBlob(blob);
      setMusicSource('upload');
      setStep6State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { musicBlob: blob, musicSource: 'upload', contentLanguage }, normalizedOwnerEmail);
      setToast(`已上傳音樂：${file.name}`);
      setTimeout(() => step7Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) {
      setStep6State({ status: 'error', error: String(e) });
      setToast('音樂上傳失敗：' + String(e));
    }
  }

  async function runAlignMusic() {
    if (!musicBlob || !lyrics || !pdfFile) return;
    setMusicVideoBlob(null);
    setMusicSrtConfirmed(false);
    setMusicPptxBlob(null);
    setStep7State({ status: 'loading' });
    try {
      const slideCount = (slides.match(/投影片\s*\d+/g) ?? []).length || 3;
      const audioBase64 = await blobToBase64(musicBlob);
      const duration = await getAudioDuration(musicBlob);

      const res = await apiFetch('/api/align-music', {
        lyrics,
        audioBase64,
        audioMimeType: musicBlob.type || 'audio/mpeg',
        duration,
        slideCount,
        textModel,
        step71Model: multimodalModel,
        step72Model: textModel,
        contentLanguage,
      });
      let timings;
      let srt = '';
      let diagnostics: AlignMusicDiagnostics | null = null;
      let visualCueTimings: VisualCueTiming[] | null = null;
      let newSrtEntries: SrtEntry[] = [];
      let newSlideCues: SrtSlideCue[] = [];
      if (res.ok) {
        const data = await res.json();
        diagnostics = data.diagnostics ?? null;
        timings = Array.isArray(data.timings) && data.timings.length > 0
          ? normalizeTimings(data.timings, slideCount, duration)
          : await calcMusicTimings(slideCount, musicBlob, lyrics);
        srt = data.srt ?? '';
        visualCueTimings = Array.isArray(data.visualCueTimings) && data.visualCueTimings.length > 0
          ? data.visualCueTimings
          : null;
        newSrtEntries = Array.isArray(data.srtEntries) ? data.srtEntries : [];
        newSlideCues = Array.isArray(data.slideCues) ? data.slideCues : [];
      } else {
        console.warn('API align-music failed, falling back to heuristic calculation.', await res.text());
        timings = await calcMusicTimings(slideCount, musicBlob, lyrics);
        // Heuristic path: no SRT entries to review — confirm immediately and build PPTX
        setMusicTimings(timings);
        setMusicSrtConfirmed(true);
        if (recordId) {
          await updateRecord(recordId, {
            musicTimings: timings,
            musicSrtConfirmed: true,
            multimodalModel, textModel, step71Model: multimodalModel, step72Model: textModel, contentLanguage,
          }, normalizedOwnerEmail);
        }
        setStep7State({ status: 'done' });
        await buildMusicPptxFromConfirmedSrt(timings);
        return;
      }

      setMusicSrtEntries(newSrtEntries);
      setMusicSlideCues(newSlideCues);
      setMusicSrt(srt);
      setMusicDiagnostics(diagnostics);
      setMusicTimings(timings);
      setMusicVisualCueTimings(visualCueTimings);
      setStep7State({ status: 'done' });

      if (recordId) {
        await updateRecord(recordId, {
          musicSrt: srt,
          musicDiagnostics: diagnostics ?? undefined,
          musicTimings: timings,
          musicSrtEntries: newSrtEntries,
          musicSlideCues: newSlideCues,
          musicSrtConfirmed: false,
          multimodalModel,
          textModel,
          step71Model: multimodalModel,
          step72Model: textModel,
          contentLanguage,
        }, normalizedOwnerEmail);
      }
      setToast('SRT 對齊完成，請確認字幕時間後繼續。');
    } catch (e) {
      setStep7State({ status: 'error', error: String(e) }); setToast('音樂對齊失敗：' + String(e));
    }
  }

  async function handleGenerateMusicPptx() {
    if (!musicBlob || !lyrics || !pdfFile) return;
    if (!musicSrtConfirmed) {
      await runAlignMusic();
      return;
    }
    await buildMusicPptxFromConfirmedSrt();
  }

  async function buildMusicPptxFromConfirmedSrt(freshTimings?: SlideTimings) {
    if (!musicBlob || !pdfFile) return;
    setMusicVideoBlob(null);
    setStep7State({ status: 'loading' });
    try {
      const slideCount = (slides.match(/投影片\s*\d+/g) ?? []).length || 3;
      const duration = await getAudioDuration(musicBlob);
      // Derive timings from cues when available — frame count must match SRT slide tags.
      let timings: SlideTimings;
      if (musicSlideCues.length > 0 && musicSrtEntries.length > 0) {
        const events = buildSlideCueEvents(musicSlideCues, musicSrtEntries);
        timings = events.length > 0
          ? buildTimingsFromSlideCueEvents(events, duration)
          : normalizeTimings([], slideCount, duration);
      } else {
        const raw = freshTimings ?? musicTimings ?? null;
        timings = Array.isArray(raw) ? raw : normalizeTimings([], slideCount, duration);
      }
      // Sync state so VideoExportBlock receives the cue-derived timings (length = cue count,
      // not PDF page count), ensuring PPTX and MP4 frame counts stay identical.
      setMusicTimings(timings);
      const adjustedTimings = buildTransitionAdjustedTimings(timings, TRANSITION_COMPENSATION_SEC, MIN_VISIBLE_SLIDE_SEC);
      const pptx = await generatePptx(pdfFile, adjustedTimings, musicBlob);
      setMusicPptxBlob(pptx);
      setStep7State({ status: 'done' });
      if (recordId) {
        await updateRecord(recordId, {
          musicPptxBlob: pptx,
          musicSrtConfirmed: true,
        }, normalizedOwnerEmail);
      }
      setToast('音樂簡報已生成！'); loadHistory();
    } catch (e) {
      setStep7State({ status: 'error', error: String(e) }); setToast('音樂簡報生成失敗：' + String(e));
    }
  }

  async function handleConfirmMusicSrt() {
    setMusicSrtConfirmed(true);
    if (recordId) {
      await updateRecord(recordId, { musicSrtConfirmed: true }, normalizedOwnerEmail);
    }
    await buildMusicPptxFromConfirmedSrt();
  }

  async function handlePodcastCuesChange(nextCues: SrtSlideCue[]) {
    setPodcastSlideCues(nextCues);
    setPodcastPptxBlob(null);
    setPodcastVideoBlob(null);
    const slideCount = (slides.match(/投影片\s*\d+/g) ?? []).length || 3;
    const duration = podcastBlob ? await getAudioDuration(podcastBlob) : 0;
    const events = buildSlideCueEvents(nextCues, podcastSrtEntries);
    const nextTimings = events.length > 0
      ? buildTimingsFromSlideCueEvents(events, duration)
      : normalizeTimings([], slideCount, duration);
    setPodcastTimings(nextTimings);
    if (recordId) {
      void updateRecord(recordId, {
        podcastSlideCues: nextCues,
        podcastTimings: nextTimings,
        podcastPptxBlob: undefined,
        podcastVideoBlob: undefined,
      }, normalizedOwnerEmail);
    }
  }

  async function handleMusicCuesChange(nextCues: SrtSlideCue[]) {
    setMusicSlideCues(nextCues);
    setMusicPptxBlob(null);
    setMusicVideoBlob(null);
    const slideCount = (slides.match(/投影片\s*\d+/g) ?? []).length || 3;
    const duration = musicBlob ? await getAudioDuration(musicBlob) : 0;
    const events = buildSlideCueEvents(nextCues, musicSrtEntries);
    const nextTimings = events.length > 0
      ? buildTimingsFromSlideCueEvents(events, duration)
      : normalizeTimings([], slideCount, duration);
    setMusicTimings(nextTimings);
    if (recordId) {
      void updateRecord(recordId, {
        musicSlideCues: nextCues,
        musicTimings: nextTimings,
        musicPptxBlob: undefined,
        musicVideoBlob: undefined,
      }, normalizedOwnerEmail);
    }
  }

  function loadRecord(rec: GenerationRecord) {
    setContentLanguage(rec.contentLanguage ?? DEFAULT_CONTENT_LANGUAGE);
    setNarrationMode(rec.narrationMode ?? 'duo');
    setNarrationLengthPreset(rec.narrationLengthPreset ?? DEFAULT_NARRATION_LENGTH_PRESET);
    setNarrationLengthNote(rec.narrationLengthNote ?? '');
    setAudioTagsEnabled(rec.audioTagsEnabled ?? false);
    if (rec.speaker1) setSpeaker1(rec.speaker1); else setSpeaker1(DEFAULT_SPEAKER1);
    if (rec.speaker2) setSpeaker2(rec.speaker2); else setSpeaker2(DEFAULT_SPEAKER2);
    if (rec.dialogueStyle) setDialogueStyle(rec.dialogueStyle); else setDialogueStyle(DEFAULT_DIALOGUE_STYLE);
    if (rec.tone) setTone(rec.tone); else setTone(DEFAULT_TONE);
    if (rec.voice1) setVoice1(rec.voice1); else setVoice1(DEFAULT_VOICE1);
    if (rec.voice2) setVoice2(rec.voice2); else setVoice2(DEFAULT_VOICE2);
    if (rec.multimodalModel) setMultimodalModel(resolveStep41ModelId(rec.multimodalModel));
    else if (rec.step41Model) setMultimodalModel(resolveStep41ModelId(rec.step41Model));
    else if (rec.step71Model) setMultimodalModel(resolveStep41ModelId(rec.step71Model));
    else setMultimodalModel(DEFAULT_MULTIMODAL_MODEL);
    const savedTextModel = rec.textModel ?? rec.step42Model ?? rec.step72Model;
    const normalizedTextModel = savedTextModel ? resolveTextModelId(savedTextModel) : null;
    if (normalizedTextModel === DEFAULT_LOCAL_TEXT_MODEL && !localLlmEnabled) setTextModel(DEFAULT_TEXT_MODEL);
    else if (normalizedTextModel) setTextModel(normalizedTextModel);
    else setTextModel(DEFAULT_TEXT_MODEL);
    if (rec.ttsModel) setTtsModel(rec.ttsModel);
    if (rec.musicModel) setMusicModel(rec.musicModel);
    if (rec.styleId) setStyleId(rec.styleId); if (rec.lyricsDuration) setLyricsDuration(rec.lyricsDuration);
    if (rec.pdfBlob) setPdfFile(new File([rec.pdfBlob], rec.pdfName, { type: 'application/pdf' })); else setPdfFile(null);
    if (rec.slides) { setSlides(rec.slides); setStep1State({ status: 'done' }); } else { setSlides(''); setStep1State({ status: 'idle' }); }
    if (rec.script) { setScript(rec.script); setStep2State({ status: 'done' }); } else { setScript(''); setStep2State({ status: 'idle' }); }
    if (rec.podcastBlob) { setPodcastBlob(rec.podcastBlob); setStep3State({ status: 'done' }); } else { setPodcastBlob(null); setStep3State({ status: 'idle' }); }
    setPodcastInputMode(rec.podcastSource ?? 'api');
    setPodcastSource(rec.podcastSource ?? 'api');
    if (rec.podcastPptxBlob) { setPodcastPptxBlob(rec.podcastPptxBlob); setStep4State({ status: 'done' }); } else { setPodcastPptxBlob(null); setStep4State({ status: 'idle' }); }
    if (rec.lyrics) { setLyrics(rec.lyrics); setStep5State({ status: 'done' }); } else { setLyrics(''); setStep5State({ status: 'idle' }); }
    if (rec.musicBlob) { setMusicBlob(rec.musicBlob); setStep6State({ status: 'done' }); } else { setMusicBlob(null); setStep6State({ status: 'idle' }); }
    setMusicInputMode(rec.musicSource ?? 'api');
    setMusicSource(rec.musicSource ?? 'api');
    if (rec.musicPptxBlob) { setMusicPptxBlob(rec.musicPptxBlob); setStep7State({ status: 'done' }); } else { setMusicPptxBlob(null); setStep7State({ status: 'idle' }); }
    if (rec.podcastSrt) setPodcastSrt(rec.podcastSrt); else setPodcastSrt('');
    if (rec.podcastDiagnostics) setPodcastDiagnostics(rec.podcastDiagnostics); else setPodcastDiagnostics(null);
    if (rec.podcastTimings) setPodcastTimings(rec.podcastTimings); else setPodcastTimings(null);
    setPodcastSrtEntries(rec.podcastSrtEntries ?? []);
    setPodcastSlideCues(rec.podcastSlideCues ?? []);
    setPodcastSrtConfirmed(rec.podcastSrtConfirmed ?? false);
    if (rec.musicSrt) setMusicSrt(rec.musicSrt); else setMusicSrt('');
    if (rec.musicDiagnostics) setMusicDiagnostics(rec.musicDiagnostics); else setMusicDiagnostics(null);
    if (rec.musicTimings) setMusicTimings(rec.musicTimings); else setMusicTimings(null);
    setMusicSrtEntries(rec.musicSrtEntries ?? []);
    setMusicSlideCues(rec.musicSlideCues ?? []);
    setMusicSrtConfirmed(rec.musicSrtConfirmed ?? false);
    setMusicVisualCueTimings(null);
    setLyricsContentSource(rec.lyricsContentSource ?? 'script');
    setScriptGeneratedAt(rec.scriptGeneratedAt ?? null);
    setLyricsGeneratedAt(rec.lyricsGeneratedAt ?? null);
    setIsEditingLyrics(false); setLyricsDraft('');
    setPodcastVideoBlob(null); setMusicVideoBlob(null);
    setPodcastSrtOffset(0); setMusicSrtOffset(0);
    setRecordId(rec.id); setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' }); setToast(`已載入：${rec.pdfName}`);
  }

  function handleNarrationModeChange(mode: NarrationMode) {
    if (mode === narrationMode) return;
    setNarrationMode(mode);
    if (script) {
      // Clear mode-derived text content so stale duo/solo script can't be used downstream
      setScript(''); setScriptGeneratedAt(null);
      setLyrics(''); setLyricsGeneratedAt(null);
      setIsEditingLyrics(false); setLyricsDraft('');
      // Reset all step states (step 3–7 depend on correct script/lyrics)
      setStep2State({ status: 'idle' });
      setStep3State({ status: 'idle' });
      setStep4State({ status: 'idle' });
      setStep5State({ status: 'idle' });
      setStep6State({ status: 'idle' });
      setStep7State({ status: 'idle' });
      // Clear analysis data tied to old script
      setPodcastSrt(''); setPodcastTimings(null); setPodcastDiagnostics(null);
      setMusicSrt(''); setMusicTimings(null); setMusicVisualCueTimings(null); setMusicDiagnostics(null);
      // Note: podcastBlob / podcastPptxBlob / musicBlob / musicPptxBlob are intentionally kept
      // — already-generated audio and PPTX assets remain valid and downloadable
    }
    // Persist immediately: don't wait for next script generation
    // Also clear mode-derived fields in DB so reloading the record stays consistent
    if (recordId) void updateRecord(recordId, {
      narrationMode: mode,
      contentLanguage,
      script: undefined,
      lyrics: undefined,
      podcastSrt: undefined,
      podcastTimings: undefined,
      podcastDiagnostics: undefined,
      musicSrt: undefined,
      musicTimings: undefined,
      musicDiagnostics: undefined,
    }, normalizedOwnerEmail);
  }

  function handleNarrationLengthPresetChange(value: NarrationLengthPreset) {
    setNarrationLengthPreset(value);
    if (recordId) {
      void updateRecord(recordId, {
        narrationLengthPreset: value,
        narrationLengthNote,
      }, normalizedOwnerEmail);
    }
  }

  function handleNarrationLengthNoteChange(value: string) {
    setNarrationLengthNote(value);
    if (recordId) {
      void updateRecord(recordId, {
        narrationLengthPreset,
        narrationLengthNote: value,
      }, normalizedOwnerEmail);
    }
  }

  function handleAudioTagsEnabledChange(value: boolean) {
    setAudioTagsEnabled(value);
    if (recordId) {
      void updateRecord(recordId, { audioTagsEnabled: value }, normalizedOwnerEmail);
    }
  }

  function handleNewProject() {
    // Design intent: clear project content only, keep user preferences
    // (speaker, voice, style, model settings). Users expect their workflow
    // setup to persist across projects; only the content is project-specific.
    setContentLanguage(DEFAULT_CONTENT_LANGUAGE);
    setNarrationLengthNote('');
    setPdfFile(null); setSlides(''); setScript(''); setLyrics('');
    setPodcastBlob(null); setMusicBlob(null); setPodcastPptxBlob(null); setMusicPptxBlob(null);
    setPodcastVideoBlob(null); setMusicVideoBlob(null);
    setPodcastInputMode('api');
    setPodcastSource('api');
    setMusicInputMode('api');
    setMusicSource('api');
    setPodcastSrt(''); setMusicSrt('');
    setPodcastSrtEntries([]); setMusicSrtEntries([]);
    setPodcastSlideCues([]); setMusicSlideCues([]);
    setPodcastSrtConfirmed(false); setMusicSrtConfirmed(false);
    setPodcastDiagnostics(null);
    setMusicDiagnostics(null);
    setPodcastSrtOffset(0);
    setMusicSrtOffset(0);
    setPodcastTimings(null);
    setMusicTimings(null);
    setMusicVisualCueTimings(null);
    setScriptGeneratedAt(null);
    setLyricsGeneratedAt(null);
    setStep1State({ status: 'idle' }); setStep1LoadingMsg('正在解析 PDF 投影片...'); setStep2State({ status: 'idle' }); setStep3State({ status: 'idle' });
    setStep4State({ status: 'idle' }); setStep5State({ status: 'idle' });
    setStep6State({ status: 'idle' }); setStep7State({ status: 'idle' });
    setIsEditingLyrics(false); setLyricsDraft('');
    setLyricsContentSource('script');
    setPptxLoading(false); setRecordId('');
    resetPdfInput();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    if (step1State.status === 'loading') return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (isPdfFile(file)) {
      void handlePdfUpload(file);
      return;
    }
    const msg = '拖放檔案必須為 pdf';
    setStep1State({ status: 'error', error: msg });
    setToast(msg);
  }

  // shared input classes
  const inputCls = `w-full border rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600/30 transition-all ${t.input}`;
  const selectCls = `w-full border rounded-xl px-3 py-1.5 text-xs appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-600/30 transition-all ${t.select}`;
  const labelCls = `block text-[10px] uppercase tracking-widest font-bold mb-1 ${t.label}`;
  const errBox = `mt-3 text-[11px] rounded-xl p-3 ${dark ? 'text-red-400 bg-red-900/20' : 'text-red-500 bg-red-50'}`;

  if (authEnabled && !authReady) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${t.page}`}>
        <div className={`rounded-3xl border px-6 py-5 text-sm ${t.card}`}>
          正在檢查登入狀態...
        </div>
      </div>
    );
  }

  if (authEnabled && !authToken) {
    return (
      <>
        <LoginPage
          dark={dark}
          onToggleTheme={() => setDark((value) => !value)}
          onLogin={handleLoginSuccess}
        />
        {toast && <Toast message={toast} onClose={() => setToast('')} />}
      </>
    );
  }

  // ─── JSX ──────────────────────────────────────
  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${t.page}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={handleDrop}
    >
      {/* drag overlay */}
      {dragging && (
        <div className="fixed inset-0 z-50 bg-emerald-700/10 border-4 border-dashed border-emerald-600 flex items-center justify-center pointer-events-none">
          <div className={`rounded-2xl px-10 py-6 shadow-2xl text-center ${dark ? 'bg-slate-800' : 'bg-white'}`}>
            <div className="text-4xl mb-2">📄</div>
            <p className={`font-bold text-sm ${t.text}`}>放開以上傳 PDF</p>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className={`sticky top-0 z-30 backdrop-blur-sm border-b shadow-sm transition-colors duration-300 ${t.header}`}>
        <div className="max-w-3xl mx-auto px-5 h-13 flex items-center justify-between py-3">
          <div className="flex items-center gap-2">
            {/* Logo icon */}
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
              <rect width="32" height="32" rx="7" fill="#047857" />
              <rect x="4" y="9" width="15" height="11" rx="2" fill="white" />
              <rect x="6" y="12" width="8" height="1.5" rx="0.75" fill="#047857" opacity="0.45" />
              <rect x="6" y="15" width="5" height="1.5" rx="0.75" fill="#047857" opacity="0.45" />
              <path d="M22 13.5 Q25.5 16 22 18.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M24.5 11 Q29.5 16 24.5 21" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.55" />
            </svg>
            <div>
              <span className={`text-sm font-extrabold tracking-tight ${t.green}`}
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                DeckCast
              </span>
              <span className={`ml-2 text-[11px] hidden sm:inline ${t.faint}`}>AI 簡報語音生成器</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {authEnabled && authEmail && (
              <div className={`hidden md:flex items-center rounded-full border px-3 py-1.5 text-[11px] font-semibold ${dark ? 'border-emerald-900/70 bg-emerald-950/40 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                {authEmail}
              </div>
            )}
            {/* Dark / Light toggle */}
            <button
              onClick={() => setDark(d => !d)}
              title={dark ? '切換白天模式' : '切換夜晚模式'}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-base border transition-all ${dark ? 'bg-slate-700 border-slate-600 hover:bg-slate-600' : 'bg-slate-100 border-slate-200 hover:bg-slate-200'
                }`}
            >{dark ? '☀️' : '🌙'}</button>
            <button onClick={handleNewProject}
              className="text-[11px] font-bold text-white emerald-gradient px-4 py-1.5 rounded-full shadow-sm shadow-emerald-900/30 active:scale-95 transition-all">
              ＋ 新專案
            </button>
            <button onClick={() => { setDrawerOpen(true); loadHistory(); }}
              className={`text-[11px] font-semibold border rounded-full px-4 py-1.5 transition-all ${dark ? 'text-slate-400 border-slate-600 hover:text-emerald-400 hover:border-emerald-700'
                : 'text-slate-500 border-slate-200 hover:text-emerald-700 hover:border-emerald-400'
                }`}>
              歷史紀錄
            </button>
            {authEnabled && (
              <button
                onClick={handleLogout}
                className={`text-[11px] font-semibold border rounded-full px-4 py-1.5 transition-all ${dark ? 'text-slate-400 border-slate-600 hover:text-red-400 hover:border-red-700' : 'text-slate-500 border-slate-200 hover:text-red-500 hover:border-red-300'}`}
              >
                登出
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-7 space-y-4">

        {/* ── Step 0: Settings ── */}
        <div className={`rounded-2xl border-2 shadow-sm p-5 transition-colors duration-300 ${t.card}`}>
          <div className="flex items-center gap-2 mb-4">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'}`}>⚙</span>
            <h2 className={`text-sm font-bold ${t.heading}`} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>設定</h2>
          </div>

          {/* API Key */}
          <div className={`mb-4 p-3.5 rounded-xl border ${t.inner}`}>
            {authEnabled && authEmail && (
              <div className={`mb-3 rounded-xl border px-3 py-2 text-[11px] ${dark ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                已登入帳號：{authEmail}
              </div>
            )}
            <label className={labelCls}>Gemini API Key</label>
            <div className="flex gap-2">
              <input type="password" value={apiKeyInput} onChange={e => setApiKeyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveApiKey()} placeholder="AIza..."
                className={`flex-1 border rounded-xl px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-600/30 transition-all ${t.input}`} />
              <ActionBtn onClick={saveApiKey}>儲存</ActionBtn>
              {apiKey && <button onClick={clearApiKey} className={`text-[11px] border rounded-xl px-3 py-1.5 transition-all ${dark ? 'text-slate-400 border-slate-600 hover:text-red-400' : 'text-slate-400 border-slate-200 hover:text-red-400'}`}>清除</button>}
            </div>
            {apiKey
              ? <p className={`text-[11px] mt-1.5 font-medium ${dark ? 'text-emerald-400' : 'text-emerald-700'}`}>✓ API Key 已設定</p>
              : <p className={`text-[11px] mt-1.5 ${t.faint}`}>僅儲存於 sessionStorage，關閉分頁後自動清除</p>}
            <p className={`text-[11px] mt-1.5 ${t.faint}`}>
              取得 API Key：
              <a
                href="https://aistudio.google.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className={`ml-1 font-semibold ${dark ? 'text-emerald-400 hover:text-emerald-300' : 'text-emerald-700 hover:text-emerald-600'}`}
              >
                Google AI Studio
              </a>
            </p>
          </div>

          {/* Narration mode selector */}
          <div className="mb-4">
            <label className={labelCls}>表達模式</label>
            <div className={`rounded-2xl border p-1.5 grid grid-cols-3 gap-1 ${t.inner}`}>
              {([
                { id: 'duo' as NarrationMode, label: '雙人對談' },
                { id: 'solo_explainer' as NarrationMode, label: '單人講解' },
                { id: 'solo_story' as NarrationMode, label: '單人說故事' },
              ]).map(({ id, label }) => {
                const active = narrationMode === id;
                return (
                  <button
                    key={id}
                    onClick={() => handleNarrationModeChange(id)}
                    className={`rounded-xl px-3 py-2 text-center transition-all border text-xs font-bold ${active
                      ? (dark ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300' : 'bg-emerald-50 border-emerald-300 text-emerald-800')
                      : (dark ? 'bg-slate-900/70 border-slate-700 text-slate-400 hover:border-emerald-800' : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-200')
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Speakers + style fields — wider grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className={labelCls}>
                {isDuo ? 'Speaker 1' : narrationMode === 'solo_explainer' ? '講者' : '敘事者'}
              </label>
              <input
                type="text" value={speaker1} onChange={e => setSpeaker1(e.target.value)}
                placeholder={isDuo ? '男生為節目主持人' : narrationMode === 'solo_explainer' ? '清晰的專業講者' : '有畫面感的故事敘述者'}
                className={inputCls}
              />
            </div>
            {isDuo && (
              <div>
                <label className={labelCls}>Speaker 2</label>
                <input type="text" value={speaker2} onChange={e => setSpeaker2(e.target.value)} placeholder="女生為 Mary 老師" className={inputCls} />
              </div>
            )}
            <div>
              <label className={labelCls}>
                {isDuo ? '對話形式' : narrationMode === 'solo_explainer' ? '講解形式' : '敘事形式'}
              </label>
              <input
                type="text" value={dialogueStyle} onChange={e => setDialogueStyle(e.target.value)}
                placeholder={isDuo ? '自然流暢的對話' : narrationMode === 'solo_explainer' ? '清楚、穩定、條理分明' : '流動、有畫面感'}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>{isDuo ? '語氣風格' : '整體基調'}</label>
              <input type="text" value={tone} onChange={e => setTone(e.target.value)} placeholder="親切、易懂" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>內容語言</label>
              <select value={contentLanguage} onChange={e => setContentLanguage(e.target.value as ContentLanguage)} className={selectCls}>
                {CONTENT_LANGUAGE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {contentLanguage !== 'zh-TW' && (
                <p className={`mt-1 text-[10px] ${dark ? 'text-amber-400/80' : 'text-amber-600'}`}>
                  非繁體中文建議搭配 Gemini 文字模型使用
                </p>
              )}
              <p className={`mt-0.5 text-[10px] ${t.faint}`}>影響 Podcast 文稿、語音、歌詞與歌曲生成</p>
            </div>
            <div>
              <label className={labelCls}>旁白長度</label>
              <select value={narrationLengthPreset} onChange={e => handleNarrationLengthPresetChange(e.target.value as NarrationLengthPreset)} className={selectCls}>
                {NARRATION_LENGTH_PRESETS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>長度補充說明（選填）</label>
              <input
                type="text"
                value={narrationLengthNote}
                onChange={e => handleNarrationLengthNoteChange(e.target.value)}
                placeholder="例如：前言精簡、案例頁詳細、最後一頁收短一點"
                className={inputCls}
              />
            </div>
          </div>

          {/* Voices + music — 4 col */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={labelCls.replace('mb-1', '')}>Voice 1</label>
                <button onClick={() => new Audio(voiceSampleUrl(voice1)).play()} className={`text-[10px] font-bold ${dark ? 'text-emerald-500' : 'text-emerald-700'} hover:opacity-70`}>▶試聽</button>
              </div>
              <select value={voice1} onChange={e => setVoice1(e.target.value)} className={selectCls}>
                {VOICES.map(v => <option key={v.name} value={v.name}>{v.name} — {v.desc}</option>)}
              </select>
            </div>
            {isDuo && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={labelCls.replace('mb-1', '')}>Voice 2</label>
                  <button onClick={() => new Audio(voiceSampleUrl(voice2)).play()} className={`text-[10px] font-bold ${dark ? 'text-emerald-500' : 'text-emerald-700'} hover:opacity-70`}>▶試聽</button>
                </div>
                <select value={voice2} onChange={e => setVoice2(e.target.value)} className={selectCls}>
                  {VOICES.map(v => <option key={v.name} value={v.name}>{v.name} — {v.desc}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>歌曲風格</label>
              <select value={styleId} onChange={e => setStyleId(Number(e.target.value))} className={selectCls}>
                {MUSIC_STYLES.map(s => <option key={s.id} value={s.id}>{s.id}. {s.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>歌詞長度</label>
              <select value={lyricsDuration} onChange={e => setLyricsDuration(e.target.value)} className={selectCls}>
                {LYRICS_DURATIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 mt-4">
            <div>
              <label className={labelCls}>Step 1 / 4.1 / 7.1 模型</label>
              <select value={multimodalModel} onChange={e => setMultimodalModel(e.target.value)} className={selectCls}>
                {MULTIMODAL_MODEL_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Step 2 / 4.2 / 5 / 7.2 模型</label>
              <select value={textModel} onChange={e => setTextModel(e.target.value)} className={selectCls}>
                  {textModelOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
            </div>
            <div>
              <label className={labelCls}>Step 3 模型</label>
              <select value={ttsModel} onChange={e => setTtsModel(e.target.value)} className={selectCls}>
                {TTS_MODEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Step 6 模型</label>
              <select value={musicModel} onChange={e => setMusicModel(e.target.value)} className={selectCls}>
                {MUSIC_MODEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>

        </div>

        {/* ── Step 1: Upload PDF ── */}
        <StepCard step={1} title="上傳 PDF" state={step1State} dark={dark}>
          <div
            className={`border-2 border-dashed rounded-2xl p-7 text-center transition-all ${step1State.status === 'loading' ? 'cursor-wait opacity-70' : 'cursor-pointer'} ${dragging ? 'border-emerald-600 bg-emerald-900/10' : t.dropzone
              }`}
            onClick={openPdfPicker}
          >
            <input
              ref={pdfUploadInputRef}
              id="pdf-input"
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void handlePdfUpload(f);
              }}
            />
            {step1State.status === 'loading' ? (
              <LoadingBar message={step1LoadingMsg} dark={dark} />
            ) : pdfFile ? (
              <div className="space-y-1">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center mx-auto mb-2 ${dark ? 'bg-emerald-900/50' : 'bg-emerald-100'}`}>
                  <span>📄</span>
                </div>
                <p className={`text-xs font-semibold ${dark ? 'text-emerald-400' : 'text-emerald-700'}`}>{pdfFile.name}</p>
                <p className={`text-[11px] ${t.faint}`}>點擊重新上傳</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto ${dark ? 'bg-slate-700' : 'bg-slate-100'}`}>
                  <span className="text-xl">📄</span>
                </div>
                <p className={`text-xs font-semibold ${t.muted}`}>拖拽或點擊上傳 PDF</p>
                <p className={`text-[11px] ${t.faint}`}>建議 3-25 頁</p>
              </div>
            )}
          </div>
          {slides && step1State.status === 'done' && (
            <div className="mt-3 space-y-2">
              <p className={`text-[11px] font-medium ${dark ? 'text-emerald-400' : 'text-emerald-700'}`}>✓ 投影片解析完成</p>
              <TextBlock text={slides} dark={dark} />
              <DownloadChip label="slides.txt" onClick={() => downloadText(slides, 'slides.txt')} dark={dark} />
            </div>
          )}
          {step1State.error && <p className={errBox}>{step1State.error}</p>}
        </StepCard>

        {/* ── Step 2 ── */}
        <div ref={step2Ref}>
          <StepCard step={2} title={isDuo ? '生成 Podcast 文稿' : narrationMode === 'solo_explainer' ? '生成講解腳本' : '生成敘事腳本'} state={step2State} disabled={!slides} dark={dark}>
            <div className="mb-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={audioTagsEnabled}
                  onChange={e => handleAudioTagsEnabledChange(e.target.checked)}
                  className="mt-0.5 accent-emerald-500"
                />
                <span className={`text-[10px] uppercase tracking-widest font-bold ${t.label}`}>
                  自動加入語氣標籤（Audio Tags）
                </span>
              </label>
              <p className={`mt-1 text-[10px] ${t.faint}`}>
                會在腳本中插入如 [enthusiasm]、[short pause] 等Audio Tags標籤，
              </p>
            </div>
            {step2State.status === 'loading'
              ? <LoadingBar message={isDuo ? '正在生成雙人對話文稿...' : narrationMode === 'solo_explainer' ? '正在生成單人講解腳本...' : '正在生成單人敘事腳本...'} dark={dark} />
              : <ActionBtn onClick={handleGenerateScript}>{step2State.status === 'done' ? '重新生成文稿' : '生成文稿'}</ActionBtn>}
            {script && step2State.status === 'done' && (
              <div className="mt-3 space-y-2">
                {isEditingScript ? (
                  <>
                    <textarea
                      className={`w-full min-h-[320px] max-h-[50vh] overflow-y-auto rounded-xl border p-3 text-sm font-mono resize-none focus:outline-none ${dark ? 'bg-zinc-800 border-zinc-600 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'}`}
                      value={scriptDraft}
                      onChange={e => setScriptDraft(e.target.value)}
                    />
                    <p className={`text-xs ${dark ? 'text-yellow-400' : 'text-yellow-600'}`}>⚠ 儲存後將清除已生成的 Podcast 音訊、簡報與字幕</p>
                    {isDuo && <p className={`text-xs ${dark ? 'text-yellow-400' : 'text-yellow-600'}`}>⚠ duo 模式下也會清除歌詞與音樂相關成品</p>}
                    <div className="flex gap-2">
                      <ActionBtn onClick={handleSaveScriptEdit}>儲存修改</ActionBtn>
                      <ActionBtn onClick={handleCancelScriptEdit}>取消</ActionBtn>
                    </div>
                  </>
                ) : (
                  <>
                    <TextBlock text={script} dark={dark} copyMode="speaker-only" />
                    <div className="flex gap-2 flex-wrap">
                      <DownloadChip label="script.txt" onClick={() => downloadText(script, buildTaggedName('script', getPodcastTag(scriptGeneratedAt), 'txt'))} dark={dark} />
                      <ActionBtn onClick={handleStartScriptEdit}>編輯腳本</ActionBtn>
                    </div>
                  </>
                )}
              </div>
            )}
            {step2State.error && <p className={errBox}>{step2State.error}</p>}
          </StepCard>
        </div>

        {/* ── Step 3 ── */}
        <div ref={step3Ref}>
          <StepCard step={3} title={isDuo ? '生成 Podcast 音訊' : narrationMode === 'solo_explainer' ? '生成講解音訊' : '生成敘事音訊'} state={step3State} disabled={!script || isEditingScript} dark={dark}>
            <div className={`mb-3 rounded-2xl border p-1.5 grid grid-cols-2 gap-1 ${t.inner}`}>
              {[
                { id: 'api' as const, title: 'API 生成', desc: '使用目前的Podcast生成流程' },
                { id: 'upload' as const, title: '上傳音訊', desc: '匯入外部工具生成的 Podcast 音訊' },
              ].map(option => {
                const active = podcastInputMode === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => setPodcastInputMode(option.id)}
                    disabled={step3State.status === 'loading'}
                    className={`rounded-xl px-3 py-2 text-left transition-all border ${active
                      ? (dark ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300' : 'bg-emerald-50 border-emerald-300 text-emerald-800')
                      : (dark ? 'bg-slate-900/70 border-slate-700 text-slate-400 hover:border-emerald-800' : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-200')
                      } ${step3State.status === 'loading' ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <p className="text-xs font-bold">{option.title}</p>
                    <p className={`text-[10px] mt-1 ${active ? '' : t.faint}`}>{option.desc}</p>
                  </button>
                );
              })}
            </div>

            {step3State.status === 'loading'
              ? <LoadingBar message={podcastInputMode === 'api'
                  ? (ttsChunkingEnabled && script && (() => {
                      const sp = estimateTtsDuration(script, narrationMode);
                      const pause = Math.max(estimateChunkCount(script, TTS_CHUNK_CHARS) - 1, 0) * (CHUNK_GAP_MS / 1000);
                      return sp + pause;
                    })() >= TTS_WARN_SEC
                      ? '正在分段生成 TTS 音訊，可能需要較久時間...'
                      : isDuo ? '正在生成雙人 TTS 音訊（約 30–60 秒）...' : '正在生成單人 TTS 音訊（約 30–60 秒）...')
                  : '正在匯入音訊檔案...'} dark={dark} />
              : podcastInputMode === 'api' ? (
                <div className="space-y-3">
                  {ttsChunkingEnabled && (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className={`text-xs whitespace-nowrap ${t.faint}`}>TTS 生成模式</label>
                      <select value={ttsGenerationMode} onChange={e => setTtsGenerationMode(e.target.value as TtsGenerationMode)} className={selectCls}>
                        <option value="single">不分段（音色較一致）</option>
                        <option value="chunked">自動分段（較不易破音）</option>
                      </select>
                      <p className={`text-[11px] ${t.faint}`}>短稿通常建議不分段；長稿若出現破音或失敗，可改用自動分段。</p>
                    </div>
                  )}
                  {(() => {
                    if (!script) return null;
                    // estimateChunkCount is a UI approximation (total chars ÷ TTS_CHUNK_CHARS);
                    // actual backend chunk count may differ due to slide boundaries and fallback logic.
                    const speechSec  = estimateTtsDuration(script, narrationMode);
                    const chunkCount = estimateChunkCount(script, TTS_CHUNK_CHARS);
                    const pauseSec   = Math.max(chunkCount - 1, 0) * (CHUNK_GAP_MS / 1000);
                    const estSec     = speechSec + (ttsGenerationMode === 'chunked' ? pauseSec : 0);
                    const estMin     = Math.ceil(estSec * 0.8 / 60);  // 實測約為估算值的 80%
                    if (estSec >= TTS_LONG_SEC) {
                      return (
                        <p className={`text-[11px] leading-relaxed rounded-lg px-3 py-2 border ${dark ? 'bg-amber-900/30 border-amber-700/60 text-amber-300' : 'bg-amber-50 border-amber-300 text-amber-800'}`}>
                          ⚠️ 長篇腳本（約 {estMin} 分鐘），{ttsGenerationMode === 'chunked' ? '將自動分段生成，預計需要較久時間，各段間有短暫停頓。' : '後段音質可能明顯劣化，建議上傳外部音訊或改用自動分段。'}
                        </p>
                      );
                    }
                    if (estSec >= TTS_WARN_SEC) {
                      return (
                        <p className={`text-[11px] leading-relaxed rounded-lg px-3 py-2 border ${dark ? 'bg-blue-900/30 border-blue-700/60 text-blue-300' : 'bg-blue-50 border-blue-300 text-blue-800'}`}>
                          ℹ️ 腳本較長（約 {estMin} 分鐘），{ttsGenerationMode === 'chunked' ? '將自動分段生成，投影片換頁處可能有輕微停頓感。' : '後段音質可能輕微劣化。'}
                        </p>
                      );
                    }
                    return null;
                  })()}
                  <ActionBtn onClick={handleGeneratePodcast}>{step3State.status === 'done' && podcastInputMode === 'api' ? '重新生成 Podcast' : '生成 Podcast 音訊'}</ActionBtn>
                  <p className={`text-[11px] leading-relaxed ${t.faint}`}>
                    也可至
                    <a
                      href="https://aistudio.google.com/generate-speech?model=gemini-2.5-flash-preview-tts"
                      target="_blank"
                      rel="noreferrer"
                      className={`mx-1 font-semibold ${dark ? 'text-emerald-400 hover:text-emerald-300' : 'text-emerald-700 hover:text-emerald-600'}`}
                    >
                      Google AI Studio Speech
                    </a>
                    自行生成 Podcast 音訊，完成後再回來上傳。
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className={`text-[11px] leading-relaxed ${t.faint}`}>
                    先完成 Step 2 取得 Podcast 文稿，再把外部工具生成的音訊匯入這裡進行 AI 對齊。
                  </p>
                  <input
                    ref={podcastUploadInputRef}
                    type="file"
                    accept={PODCAST_AUDIO_ACCEPT}
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handlePodcastUpload(file);
                      e.currentTarget.value = '';
                    }}
                  />
                  <button
                    onClick={() => podcastUploadInputRef.current?.click()}
                    className={`w-full border-2 border-dashed rounded-2xl p-5 text-center transition-all ${dark ? 'border-slate-600 hover:border-emerald-600 hover:bg-emerald-900/15' : 'border-slate-200 hover:border-emerald-500 hover:bg-emerald-50'}`}
                  >
                    <div className="space-y-1.5">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto ${dark ? 'bg-slate-700' : 'bg-slate-100'}`}>
                        <span className="text-xl">🎙️</span>
                      </div>
                      <p className={`text-xs font-semibold ${t.text}`}>{podcastBlob && podcastInputMode === 'upload' ? '重新上傳 Podcast 音訊' : '選擇 Podcast 音訊檔案'}</p>
                      <p className={`text-[11px] ${t.faint}`}>支援常見格式：.mp3 / .wav / .m4a / .aac，檔案上限 50MB</p>
                    </div>
                  </button>
                </div>
              )}
            {podcastBlob && step3State.status === 'done' && (
              <div className="mt-3 space-y-2">
                <AudioPlayer blob={podcastBlob} label={podcastSource === 'upload' ? '上傳的 Podcast' : 'AI 生成 Podcast'} dark={dark} />
                <DownloadChip
                  label={getPodcastDownloadName(podcastBlob)}
                  onClick={() => {
                    const ext = getAudioExtension(podcastBlob.type, 'mp3');
                    downloadBlob(podcastBlob, buildTaggedName('podcast', getPodcastTag(scriptGeneratedAt), ext));
                  }}
                  dark={dark}
                />
              </div>
            )}
            {step3State.error && <p className={errBox}>{step3State.error}</p>}
          </StepCard>
        </div>

        {/* ── Step 4 ── */}
        <div ref={step4Ref}>
          <StepCard step={4} title={isDuo ? '生成 Podcast 字幕與換頁標記' : narrationMode === 'solo_explainer' ? '生成講解字幕與換頁標記' : '生成敘事字幕與換頁標記'} state={step4State} disabled={!podcastBlob || !script || isEditingScript} dark={dark}>
            {step4State.status === 'loading'
              ? <LoadingBar message={podcastSrtEntries.length === 0 ? 'AI 正在聆聽 Podcast 並標記轉場時間（可能需要 20-40 秒）...' : '正在封裝簡報...'} dark={dark} />
              : (
                <div className="space-y-3">
                  <ActionBtn onClick={handleGeneratePodcastPptx}>
                    {podcastSrtEntries.length > 0 ? '重新執行 SRT 對齊' : '生成字幕與換頁標記'}
                  </ActionBtn>
                  <p className={`text-[11px] leading-relaxed ${t.faint}`}>
                    對齊時會同時使用 Podcast 音訊與 Step 2 文稿，因此外部上傳音訊前也需要先保留對應文稿。
                  </p>
                </div>
              )}
            {podcastSrtEntries.length > 0 && (
              <div className="mt-3 space-y-3">
                <SrtReviewPanel
                  audioBlob={podcastBlob}
                  srtEntries={podcastSrtEntries}
                  srtConfirmed={podcastSrtConfirmed}
                  onConfirm={handleConfirmPodcastSrt}
                  onRealign={runAlignPodcast}
                  realigning={step4State.status === 'loading'}
                  dark={dark}
                />
                {podcastSrtConfirmed && (
                  <>
                    <SrtCueEditor
                      srtEntries={podcastSrtEntries}
                      slideCues={podcastSlideCues}
                      slideCount={(slides.match(/投影片\s*\d+/g) ?? []).length || 3}
                      onChange={handlePodcastCuesChange}
                      pdfBlob={pdfFile}
                      dark={dark}
                    />
                    <div className="space-y-2">
                      <ActionBtn onClick={buildPodcastPptxFromConfirmedSrt} disabled={step4State.status === 'loading'}>
                        {step4State.status === 'loading' ? '正在生成 Podcast 簡報...' : (podcastPptxBlob ? '重新生成 Podcast 簡報' : '生成 Podcast 簡報')}
                      </ActionBtn>
                      {podcastPptxBlob && step4State.status === 'done' && (
                        <div className="space-y-2">
                          <p className={`text-[11px] font-medium ${dark ? 'text-emerald-400' : 'text-emerald-700'}`}>✓ 語音畫面完美同步！</p>
                          {podcastDiagnostics && (
                            <p className={`text-[11px] ${t.faint}`}>
                              ASR 模式：{podcastDiagnostics.asrMode} ／ 字幕來源：{podcastDiagnostics.srtSource} ／ 對齊來源：{podcastDiagnostics.timingSource} ／ 字幕確認：{podcastSrtConfirmed ? '✓ 已確認' : '自動'}
                            </p>
                          )}
                          <DownloadChip label="podcast.pptx" onClick={() => downloadBlob(podcastPptxBlob, buildTaggedName('podcast', getPodcastTag(scriptGeneratedAt), 'pptx'))} dark={dark} />
                          {podcastSrt && (
                            <div className="inline-flex items-center">
                              <DownloadChip label="podcast.srt" onClick={() => downloadText(adjustSrtTimes(podcastSrtForDownload, podcastSrtOffset), buildTaggedName('podcast', getPodcastTag(scriptGeneratedAt), 'srt'))} dark={dark} />
                              <OffsetSelect offset={podcastSrtOffset} onChange={setPodcastSrtOffset} dark={dark} />
                              {podcastTimings && podcastSrtOffset !== 0 && (
                                <button onClick={handleRepackPodcastPptx} className={`ml-2 text-[11px] font-semibold px-2 py-1.5 rounded border transition-all ${dark ? 'text-amber-400 border-amber-500 hover:bg-amber-500/20' : 'text-amber-700 bg-amber-50 border-amber-300 hover:bg-amber-100'}`}>
                                  套用偏移至轉場
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            {step4State.error && <p className={errBox}>{step4State.error}</p>}
          </StepCard>
        </div>

        {podcastPptxBlob && step4State.status === 'done' && videoExportEnabled && (
          <VideoExportBlock
            title="匯出 Podcast 影片"
            pdfBlob={pdfFile}
            audioBlob={podcastBlob}
            timings={podcastTimings}
            filename={buildTaggedName('podcast', getPodcastTag(scriptGeneratedAt), 'mp4')}
            displayName="podcast.mp4"
            cachedBlob={podcastVideoBlob}
            cachedFilename={podcastVideoFilename}
            onCached={(blob, nextFilename) => {
              setPodcastVideoBlob(blob);
              setPodcastVideoFilename(nextFilename);
            }}
            onClearCache={() => setPodcastVideoBlob(null)}
            dark={dark}
            videoExportEnabled={videoExportEnabled}
            srtText={podcastSrt}
          />
        )}

        {/* ── Step 5 ── */}
        <div ref={step5Ref}>
          <StepCard step={5} title="生成歌詞" state={step5State} disabled={(lyricsContentSource === 'slides' ? !slides : !script) || isEditingScript} dark={dark}>
            <div className="mb-3">
              <label className={labelCls}>歌詞內容依據</label>
              <select
                value={lyricsContentSource}
                onChange={e => handleLyricsContentSourceChange(e.target.value as 'script' | 'slides')}
                className={selectCls}
                disabled={step5State.status === 'loading' || isEditingLyrics}
              >
                <option value="script">依講稿生成</option>
                <option value="slides">依投影片生成</option>
              </select>
              <p className={`text-xs mt-1 ${t.muted}`}>
                依講稿生成：歌詞會更貼近 Step 2 的敘事與鋪陳；依投影片生成：歌詞會更聚焦投影片重點。
              </p>
            </div>
            {step5State.status === 'loading'
              ? <LoadingBar message="正在生成歌詞..." dark={dark} />
              : <ActionBtn onClick={handleGenerateLyrics} disabled={isEditingLyrics}>{step5State.status === 'done' ? '重新生成歌詞' : '生成歌詞'}</ActionBtn>}
            {lyrics && step5State.status === 'done' && (
              <div className="mt-3 space-y-2">
                {isEditingLyrics ? (
                  <>
                    <textarea
                      value={lyricsDraft}
                      onChange={e => setLyricsDraft(e.target.value)}
                      className={`w-full h-64 rounded-xl border p-3 text-sm font-mono resize-y ${dark ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-800'}`}
                    />
                    <p className={`text-xs ${dark ? 'text-amber-400' : 'text-amber-600'}`}>
                      ⚠ 儲存後將清除歌曲音訊／對齊／簡報，需重新生成。請保留 [Slide N] 結構標記。
                    </p>
                    <div className="flex gap-2">
                      <ActionBtn onClick={handleSaveLyricsEdit}>儲存修改</ActionBtn>
                      <ActionBtn onClick={handleCancelLyricsEdit}>取消</ActionBtn>
                    </div>
                  </>
                ) : (
                  <>
                    <TextBlock text={lyrics} dark={dark} />
                    <div className="flex gap-2 flex-wrap">
                      <DownloadChip label="lyrics.txt" onClick={() => downloadText(lyrics, buildTaggedName('lyrics', getMusicTag(lyricsGeneratedAt), 'txt'))} dark={dark} />
                      <ActionBtn onClick={handleStartLyricsEdit}>編輯歌詞</ActionBtn>
                    </div>
                  </>
                )}
              </div>
            )}
            {step5State.error && <p className={errBox}>{step5State.error}</p>}
          </StepCard>
        </div>

        {/* ── Step 6 ── */}
        <div ref={step6Ref}>
          <StepCard step={6} title="生成歌曲音訊" state={step6State} disabled={!lyrics || isEditingScript || isEditingLyrics} dark={dark}>
            <div className={`mb-3 rounded-2xl border p-1.5 grid grid-cols-2 gap-1 ${t.inner}`}>
              {[
                { id: 'api' as const, title: 'API 生成', desc: '使用目前的歌曲生成流程' },
                { id: 'upload' as const, title: '上傳 mp3', desc: '匯入外部工具生成的音樂' },
              ].map(option => {
                const active = musicInputMode === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => setMusicInputMode(option.id)}
                    disabled={step6State.status === 'loading'}
                    className={`rounded-xl px-3 py-2 text-left transition-all border ${active
                      ? (dark ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300' : 'bg-emerald-50 border-emerald-300 text-emerald-800')
                      : (dark ? 'bg-slate-900/70 border-slate-700 text-slate-400 hover:border-emerald-800' : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-200')
                      } ${step6State.status === 'loading' ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <p className="text-xs font-bold">{option.title}</p>
                    <p className={`text-[10px] mt-1 ${active ? '' : t.faint}`}>{option.desc}</p>
                  </button>
                );
              })}
            </div>
            {step6State.status === 'loading'
              ? <LoadingBar message={musicInputMode === 'api' ? '正在生成 AI 歌曲（約 30–60 秒）...' : '正在匯入 mp3 音樂檔案...'} dark={dark} />
              : musicInputMode === 'api' ? (
                <div className="space-y-3">
                  <ActionBtn onClick={handleGenerateMusic}>{step6State.status === 'done' && musicInputMode === 'api' ? '重新生成歌曲' : '生成歌曲音訊'}</ActionBtn>
                  <p className={`text-[11px] leading-relaxed ${t.faint}`}>
                    也可至
                    <a
                      href="https://www.producer.ai/invite/XH4T5Q"
                      target="_blank"
                      rel="noreferrer"
                      className={`mx-1 font-semibold ${dark ? 'text-emerald-400 hover:text-emerald-300' : 'text-emerald-700 hover:text-emerald-600'}`}
                    >
                      Producer.ai
                    </a>
                    自行生成歌曲音訊，完成後再回來上傳。
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    ref={musicUploadInputRef}
                    type="file"
                    accept={MUSIC_AUDIO_ACCEPT}
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleMusicUpload(file);
                      e.currentTarget.value = '';
                    }}
                  />
                  <button
                    onClick={() => musicUploadInputRef.current?.click()}
                    className={`w-full border-2 border-dashed rounded-2xl p-5 text-center transition-all ${dark ? 'border-slate-600 hover:border-emerald-600 hover:bg-emerald-900/15' : 'border-slate-200 hover:border-emerald-500 hover:bg-emerald-50'}`}
                  >
                    <div className="space-y-1.5">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto ${dark ? 'bg-slate-700' : 'bg-slate-100'}`}>
                        <span className="text-xl">🎵</span>
                      </div>
                      <p className={`text-xs font-semibold ${t.text}`}>{musicBlob && musicInputMode === 'upload' ? '重新上傳 mp3' : '選擇 mp3 音樂檔案'}</p>
                      <p className={`text-[11px] ${t.faint}`}>支援外部 App 產生的 `.mp3` 檔</p>
                    </div>
                  </button>
                </div>
              )}
            {musicBlob && step6State.status === 'done' && (
              <div className="mt-3 space-y-2">
                <AudioPlayer blob={musicBlob} label={musicSource === 'upload' ? '上傳的歌曲' : 'AI 歌曲'} dark={dark} />
                <DownloadChip label="music.mp3" onClick={() => downloadBlob(musicBlob, buildTaggedName('music', getMusicTag(lyricsGeneratedAt), 'mp3'))} dark={dark} />
              </div>
            )}
            {step6State.error && (
              <div className="mt-3 space-y-2">
                <p className={errBox}>{step6State.error}</p>
                {step6State.error.includes('PROHIBITED_CONTENT') && (
                  <button onClick={() => { setStep5State({ status: 'idle' }); setLyrics(''); step5Ref.current?.scrollIntoView({ behavior: 'smooth' }); }}
                    className={`text-[11px] font-bold px-4 py-2 rounded-full transition-all ${dark ? 'bg-amber-900/40 text-amber-400 hover:bg-amber-900/60' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
                    ↩ 回到 Step 5 重新生成歌詞
                  </button>
                )}
              </div>
            )}
          </StepCard>
        </div>

        {/* ── Step 7 ── */}
        <div ref={step7Ref}>
          <StepCard step={7} title="生成歌曲字幕與換頁標記" state={step7State} disabled={!musicBlob || isEditingScript || isEditingLyrics} dark={dark}>
            {step7State.status === 'loading'
              ? <LoadingBar message={musicSrtEntries.length === 0 ? 'AI 正在聆聽歌曲結構並標記轉場時間（可能需要 20-40 秒）...' : '正在封裝簡報...'} dark={dark} />
              : <ActionBtn onClick={handleGenerateMusicPptx}>
                  {musicSrtEntries.length > 0 ? '重新執行 SRT 對齊' : '生成字幕與換頁標記'}
                </ActionBtn>}
            {musicSrtEntries.length > 0 && (
              <div className="mt-3 space-y-3">
                <SrtReviewPanel
                  audioBlob={musicBlob}
                  srtEntries={musicSrtEntries}
                  srtConfirmed={musicSrtConfirmed}
                  onConfirm={handleConfirmMusicSrt}
                  onRealign={runAlignMusic}
                  realigning={step7State.status === 'loading'}
                  dark={dark}
                />
                {musicSrtConfirmed && (
                  <>
                    <SrtCueEditor
                      srtEntries={musicSrtEntries}
                      slideCues={musicSlideCues}
                      slideCount={(slides.match(/投影片\s*\d+/g) ?? []).length || 3}
                      onChange={handleMusicCuesChange}
                      pdfBlob={pdfFile}
                      dark={dark}
                    />
                    <div className="space-y-2">
                      <ActionBtn onClick={buildMusicPptxFromConfirmedSrt} disabled={step7State.status === 'loading'}>
                        {step7State.status === 'loading' ? '正在生成歌曲簡報...' : (musicPptxBlob ? '重新生成歌曲簡報' : '生成歌曲簡報')}
                      </ActionBtn>
                      {musicPptxBlob && step7State.status === 'done' && (
                        <div className="space-y-2">
                          <p className={`text-[11px] font-medium ${dark ? 'text-emerald-400' : 'text-emerald-700'}`}>✓ 歌曲段落畫面同步！</p>
                          {musicDiagnostics && (
                            <p className={`text-[11px] ${t.faint}`}>
                              ASR 模式：{musicDiagnostics.asrMode} ／ 字幕來源：{musicDiagnostics.srtSource} ／ 對齊來源：{musicDiagnostics.timingSource} ／ 字幕確認：{musicSrtConfirmed ? '✓ 已確認' : '自動'}
                            </p>
                          )}
                          <DownloadChip label="music.pptx" onClick={() => downloadBlob(musicPptxBlob, buildTaggedName('music', getMusicTag(lyricsGeneratedAt), 'pptx'))} dark={dark} />
                          {musicSrt && (
                            <div className="inline-flex items-center">
                              <DownloadChip label="music.srt" onClick={() => downloadText(adjustSrtTimes(musicSrtForDownload, musicSrtOffset), buildTaggedName('music', getMusicTag(lyricsGeneratedAt), 'srt'))} dark={dark} />
                              <OffsetSelect offset={musicSrtOffset} onChange={setMusicSrtOffset} dark={dark} />
                              {musicTimings && musicSrtOffset !== 0 && (
                                <button onClick={handleRepackMusicPptx} className={`ml-2 text-[11px] font-semibold px-2 py-1.5 rounded border transition-all ${dark ? 'text-amber-400 border-amber-500 hover:bg-amber-500/20' : 'text-amber-700 bg-amber-50 border-amber-300 hover:bg-amber-100'}`}>
                                  套用偏移至轉場
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            {step7State.error && <p className={errBox}>{step7State.error}</p>}
          </StepCard>
        </div>

        {musicPptxBlob && step7State.status === 'done' && videoExportEnabled && (
          <VideoExportBlock
            title="匯出歌曲影片"
            pdfBlob={pdfFile}
            audioBlob={musicBlob}
            timings={musicTimings}
            filename={buildTaggedName('music', getMusicTag(lyricsGeneratedAt), 'mp4')}
            displayName="music.mp4"
            cachedBlob={musicVideoBlob}
            cachedFilename={musicVideoFilename}
            onCached={(blob, nextFilename) => {
              setMusicVideoBlob(blob);
              setMusicVideoFilename(nextFilename);
            }}
            onClearCache={() => setMusicVideoBlob(null)}
            dark={dark}
            videoExportEnabled={videoExportEnabled}
            srtText={musicSrt}
          />
        )}

        {/* ── Download Panel ── */}
        {(slides || script || lyrics || podcastBlob || musicBlob) && (
          <div className={`rounded-2xl border-2 p-5 transition-colors duration-300 ${t.greenBg}`}>
            <h2 className={`text-xs font-bold mb-4 flex items-center gap-2 ${dark ? 'text-emerald-400' : 'text-emerald-800'}`}
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              <span className={`w-5 h-5 rounded-full text-white text-[10px] flex items-center justify-center bg-emerald-700`}>↓</span>
              下載所有檔案
            </h2>

            {/* 📄 文字 */}
            <div className="mb-3">
              <p className={`text-[10px] uppercase tracking-widest font-bold mb-1.5 ${dark ? 'text-slate-600' : 'text-slate-400'}`}>📄 文字</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'slides.txt', avail: !!slides, fn: () => slides && downloadText(slides, 'slides.txt') },
                  { label: 'script.txt', avail: !!script, fn: () => script && downloadText(script, buildTaggedName('script', getPodcastTag(scriptGeneratedAt), 'txt')) },
                  { label: 'lyrics.txt', avail: !!lyrics, fn: () => lyrics && downloadText(lyrics, buildTaggedName('lyrics', getMusicTag(lyricsGeneratedAt), 'txt')) },
                  { label: 'podcast.srt', avail: !!podcastSrt, fn: () => podcastSrt && downloadText(adjustSrtTimes(podcastSrtForDownload, podcastSrtOffset), buildTaggedName('podcast', getPodcastTag(scriptGeneratedAt), 'srt')) },
                  { label: 'music.srt', avail: !!musicSrt, fn: () => musicSrt && downloadText(adjustSrtTimes(musicSrtForDownload, musicSrtOffset), buildTaggedName('music', getMusicTag(lyricsGeneratedAt), 'srt')) },
                ].map(({ label, avail, fn }) => (
                  <button key={label} onClick={fn} disabled={!avail}
                    className={`flex items-center justify-center gap-1 px-2 py-2 rounded-xl text-[11px] font-semibold border transition-all ${t.dlBtn(avail, false)}`}>
                    {avail ? '⬇' : '🔒'} {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 🎧 音訊 */}
            <div className="mb-3">
              <p className={`text-[10px] uppercase tracking-widest font-bold mb-1.5 ${dark ? 'text-slate-600' : 'text-slate-400'}`}>🎧 音訊</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: podcastBlob ? getPodcastDownloadName(podcastBlob) : 'podcast.mp3', avail: !!podcastBlob, load: false, fn: () => { if (!podcastBlob) return; const ext = getAudioExtension(podcastBlob.type, 'mp3'); downloadBlob(podcastBlob, buildTaggedName('podcast', getPodcastTag(scriptGeneratedAt), ext)); } },
                  { label: 'music.mp3', avail: !!musicBlob, load: false, fn: () => musicBlob && downloadBlob(musicBlob, buildTaggedName('music', getMusicTag(lyricsGeneratedAt), 'mp3')) },
                ].map(({ label, avail, load, fn }) => (
                  <button key={label} onClick={fn} disabled={!avail && !load}
                    className={`flex items-center justify-center gap-1 px-2 py-2 rounded-xl text-[11px] font-semibold border transition-all ${t.dlBtn(avail, load)}`}>
                    {load ? '⏳' : avail ? '⬇' : '🔒'} {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 📊 簡報 */}
            <div>
              <p className={`text-[10px] uppercase tracking-widest font-bold mb-1.5 ${dark ? 'text-slate-600' : 'text-slate-400'}`}>📊 簡報</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'podcast.pptx', avail: !!podcastPptxBlob, load: pptxLoading, fn: () => podcastPptxBlob && downloadBlob(podcastPptxBlob, buildTaggedName('podcast', getPodcastTag(scriptGeneratedAt), 'pptx')) },
                  { label: 'music.pptx', avail: !!musicPptxBlob, load: pptxLoading, fn: () => musicPptxBlob && downloadBlob(musicPptxBlob, buildTaggedName('music', getMusicTag(lyricsGeneratedAt), 'pptx')) },
                ].map(({ label, avail, load, fn }) => (
                  <button key={label} onClick={fn} disabled={!avail && !load}
                    className={`flex items-center justify-center gap-1 px-2 py-2 rounded-xl text-[11px] font-semibold border transition-all ${t.dlBtn(avail, load)}`}>
                    {load ? '⏳' : avail ? '⬇' : '🔒'} {label}
                  </button>
                ))}
              </div>
            </div>
            {videoExportEnabled && (podcastVideoBlob || musicVideoBlob) && (
              <div>
                <p className={`text-[10px] uppercase tracking-widest font-bold mb-1.5 ${dark ? 'text-slate-600' : 'text-slate-400'}`}>🎬 影片</p>
                <div className="grid grid-cols-2 gap-2">
                  {podcastVideoBlob && (
                    <button
                      onClick={() => downloadBlob(podcastVideoBlob, podcastVideoFilename ?? buildTaggedName('podcast', getPodcastTag(scriptGeneratedAt), 'mp4'))}
                      className={`flex items-center justify-center gap-1 px-2 py-2 rounded-xl text-[11px] font-semibold border transition-all ${t.dlBtn(true, false)}`}
                    >
                      ⬇ {podcastVideoFilename ?? 'podcast.mp4'}
                    </button>
                  )}
                  {musicVideoBlob && (
                    <button
                      onClick={() => downloadBlob(musicVideoBlob, musicVideoFilename ?? buildTaggedName('music', getMusicTag(lyricsGeneratedAt), 'mp4'))}
                      className={`flex items-center justify-center gap-1 px-2 py-2 rounded-xl text-[11px] font-semibold border transition-all ${t.dlBtn(true, false)}`}
                    >
                      ⬇ {musicVideoFilename ?? 'music.mp4'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── History Drawer ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex">
          <div className={`flex-1 ${dark ? 'bg-black/50' : 'bg-black/25'} backdrop-blur-sm`} onClick={() => setDrawerOpen(false)} />
          <div className={`w-80 border-l shadow-2xl p-5 overflow-y-auto flex flex-col transition-colors duration-300 ${t.drawer}`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className={`text-sm font-bold ${t.heading}`} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>歷史紀錄</h3>
              <button onClick={() => setDrawerOpen(false)}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition-all ${dark ? 'bg-slate-700 text-slate-400 hover:bg-slate-600' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>✕</button>
            </div>
            {history.length === 0 ? (
              <div className={`text-center py-10 ${t.faint}`}>
                <div className="text-3xl mb-2">📂</div>
                <p className="text-xs">尚無紀錄</p>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map(rec => (
                  <div key={rec.id} className={`rounded-2xl p-4 space-y-3 border transition-all ${t.drawerItem}`}>
                    <div>
                      <p className={`text-xs font-semibold truncate ${t.text}`}>{rec.pdfName}</p>
                      <p className={`text-[11px] mt-0.5 ${t.faint}`}>{new Date(rec.createdAt).toLocaleString('zh-TW')}</p>
                      {rec.musicStyle && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${dark ? 'bg-emerald-900/50 text-emerald-400' : 'bg-emerald-100 text-emerald-700'}`}>{rec.musicStyle}</span>}
                    </div>
                    <button onClick={() => loadRecord(rec)}
                      className="w-full text-[11px] font-bold text-white emerald-gradient rounded-xl py-1.5 active:scale-95 transition-all shadow-sm shadow-emerald-900/30">
                      載入此紀錄
                    </button>
                    <div className="flex flex-wrap gap-1.5">
                      {rec.script && <button onClick={() => downloadText(rec.script!, buildTaggedName('script', getPodcastTag(rec.scriptGeneratedAt, rec.createdAt), 'txt'))} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓script</button>}
                      {rec.lyrics && <button onClick={() => downloadText(rec.lyrics!, buildTaggedName('lyrics', getMusicTag(rec.lyricsGeneratedAt, rec.createdAt), 'txt'))} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓lyrics</button>}
                      {rec.podcastBlob && <button onClick={() => { const ext = getAudioExtension(rec.podcastBlob!.type, 'mp3'); downloadBlob(rec.podcastBlob!, buildTaggedName('podcast', getPodcastTag(rec.scriptGeneratedAt, rec.createdAt), ext)); }} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓podcast</button>}
                      {rec.musicBlob && <button onClick={() => downloadBlob(rec.musicBlob!, buildTaggedName('music', getMusicTag(rec.lyricsGeneratedAt, rec.createdAt), 'mp3'))} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓music</button>}
                      {rec.podcastPptxBlob && <button onClick={() => downloadBlob(rec.podcastPptxBlob!, buildTaggedName('podcast', getPodcastTag(rec.scriptGeneratedAt, rec.createdAt), 'pptx'))} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓pptx</button>}
                      {rec.musicPptxBlob && <button onClick={() => downloadBlob(rec.musicPptxBlob!, buildTaggedName('music', getMusicTag(rec.lyricsGeneratedAt, rec.createdAt), 'pptx'))} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓music.pptx</button>}
                      {rec.podcastSrt && <button onClick={() => {
                          const srt = rec.podcastSlideCues?.length && rec.podcastSrtEntries?.length ? serializeSrtWithSlideTags(rec.podcastSrtEntries, rec.podcastSlideCues) : rec.podcastSrt!;
                          downloadText(srt, buildTaggedName('podcast', getPodcastTag(rec.scriptGeneratedAt, rec.createdAt), 'srt'));
                        }} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-amber-400 bg-amber-900/30 hover:bg-amber-900/50' : 'text-amber-700 bg-amber-50 hover:bg-amber-100'}`}>↓podcast.srt</button>}
                      {rec.musicSrt && <button onClick={() => {
                          const srt = rec.musicSlideCues?.length && rec.musicSrtEntries?.length ? serializeSrtWithSlideTags(rec.musicSrtEntries, rec.musicSlideCues) : rec.musicSrt!;
                          downloadText(srt, buildTaggedName('music', getMusicTag(rec.lyricsGeneratedAt, rec.createdAt), 'srt'));
                        }} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-amber-400 bg-amber-900/30 hover:bg-amber-900/50' : 'text-amber-700 bg-amber-50 hover:bg-amber-100'}`}>↓music.srt</button>}
                      <button onClick={() => { void deleteRecord(rec.id, normalizedOwnerEmail); void loadHistory(); }}
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ml-auto ${dark ? 'text-red-400 bg-red-900/30 hover:bg-red-900/50' : 'text-red-500 bg-red-50 hover:bg-red-100'}`}>刪除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onClose={() => setToast('')} />}

      {/* ── Footer ── */}
      <footer className={`mt-12 border-t py-5 transition-colors duration-300 ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
        <div className="max-w-3xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className={`text-[11px] font-bold ${t.green}`} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>DeckCast</span>
          <span className={`text-[11px] ${t.faint}`}>讓簡報開口說話 · AI 簡報語音生成器</span>
			<span className={`text-[11px] ${t.faint}`}>
			  Contact NCHC ·{" "}
			  <a
				href="mailto:0203126@niar.org.tw"
				className={`underline transition-opacity hover:opacity-80 ${dark ? 'text-slate-300' : 'text-slate-600'}`}
			  >
				0203126@niar.org.tw
			  </a>
			</span>
        </div>
      </footer>
    </div>
  );
}
