'use client';

import { useState, useEffect, useRef } from 'react';
import { setUnauthorizedHandler, apiFetch } from '@/lib/apiFetch';
import LoginPage from '@/components/LoginPage';
import { generatePptx } from '@/lib/generatePptx';
import { calcPodcastTimings, calcMusicTimings, normalizeTimings, getAudioDuration, shiftTimings } from '@/lib/timing';
import { adjustSrtTimes } from '@/lib/srt';
import { saveRecord, updateRecord, getAllRecords, getRecordsByOwner, deleteRecord } from '@/lib/db';
import { clearAuthSession, isAuthEnabledClient, readStoredAuthSession, storeAuthSession, type AuthSession } from '@/lib/authClient';
import type { AlignMusicDiagnostics, AlignPodcastDiagnostics, GenerationRecord, StepState, SlideTimings } from '@/lib/types';
import { MUSIC_STYLES, VOICES } from '@/lib/types';
import {
  AUTH_EMAIL_KEY, AUTH_TOKEN_KEY, SESSION_KEY,
  DEFAULT_SPEAKER1, DEFAULT_SPEAKER2, DEFAULT_DIALOGUE_STYLE, DEFAULT_TONE,
  DEFAULT_VOICE1, DEFAULT_VOICE2, DEFAULT_STYLE_ID, DEFAULT_LYRICS_DURATION,
  DEFAULT_TEXT_MODEL, DEFAULT_LOCAL_TEXT_MODEL, DEFAULT_MULTIMODAL_MODEL, DEFAULT_TTS_MODEL, DEFAULT_MUSIC_MODEL,
  TEXT_MODEL_OPTIONS, MULTIMODAL_MODEL_OPTIONS, TTS_MODEL_OPTIONS, MUSIC_MODEL_OPTIONS,
  LYRICS_DURATIONS, voiceSampleUrl,
  PODCAST_MAX_FILE_SIZE, MUSIC_MAX_FILE_SIZE, PODCAST_AUDIO_ACCEPT, MUSIC_AUDIO_ACCEPT,
} from '@/lib/constants';

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
function TextBlock({ text, dark }: { text: string; dark: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const t = useTheme(dark);
  return (
    <div className="space-y-1.5">
      <div className={`border rounded-xl p-3 text-[11px] font-mono whitespace-pre-wrap overflow-y-auto transition-all leading-relaxed ${t.mono} ${expanded ? 'max-h-[45vh]' : 'max-h-28'}`}>
        {text}
      </div>
      <button onClick={() => setExpanded(e => !e)} className={`text-[11px] font-semibold ${t.green} hover:opacity-80`}>
        {expanded ? '↑ 收合' : '↓ 展開全文'}
      </button>
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
  const [step1State, setStep1State] = useState<StepState>({ status: 'idle' });
  const [step2State, setStep2State] = useState<StepState>({ status: 'idle' });
  const [step3State, setStep3State] = useState<StepState>({ status: 'idle' });
  const [step4State, setStep4State] = useState<StepState>({ status: 'idle' });
  const [step5State, setStep5State] = useState<StepState>({ status: 'idle' });
  const [step6State, setStep6State] = useState<StepState>({ status: 'idle' });
  const [step7State, setStep7State] = useState<StepState>({ status: 'idle' });
  const [pptxLoading, setPptxLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [recordId, setRecordId] = useState('');
  const [dragging, setDragging] = useState(false);

  const step2Ref = useRef<HTMLDivElement>(null);
  const step3Ref = useRef<HTMLDivElement>(null);
  const step4Ref = useRef<HTMLDivElement>(null);
  const step5Ref = useRef<HTMLDivElement>(null);
  const step6Ref = useRef<HTMLDivElement>(null);
  const step7Ref = useRef<HTMLDivElement>(null);
  const podcastUploadInputRef = useRef<HTMLInputElement>(null);
  const musicUploadInputRef = useRef<HTMLInputElement>(null);

  const t = useTheme(dark);
  const normalizedOwnerEmail = authEnabled ? authEmail.trim().toLowerCase() : undefined;
  const textModelOptions = localLlmEnabled
    ? TEXT_MODEL_OPTIONS.map(option => option.value === DEFAULT_LOCAL_TEXT_MODEL
      ? { ...option, label: `${localLlmLabel}（預設）` }
      : option)
    : TEXT_MODEL_OPTIONS.filter(option => option.value !== DEFAULT_LOCAL_TEXT_MODEL);

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
        const data = await res.json() as { localLlmEnabled?: boolean; localLlmLabel?: string };
        const enabled = Boolean(data.localLlmEnabled);
        const label = data.localLlmLabel?.trim() || 'Gemma 4';
        setLocalLlmEnabled(enabled);
        setLocalLlmLabel(label);
        setTextModel(prev => {
          if (enabled) {
            return prev === DEFAULT_TEXT_MODEL ? DEFAULT_LOCAL_TEXT_MODEL : prev;
          }
          return prev === DEFAULT_LOCAL_TEXT_MODEL ? DEFAULT_TEXT_MODEL : prev;
        });
      } catch {
        setLocalLlmEnabled(false);
        setLocalLlmLabel('Gemma 4');
        setTextModel(prev => prev === DEFAULT_LOCAL_TEXT_MODEL ? DEFAULT_TEXT_MODEL : prev);
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
  }

  function resetMusicDerivedState() {
    setMusicPptxBlob(null);
    setMusicSrt('');
    setMusicDiagnostics(null);
    setStep7State({ status: 'idle' });
    if (recordId) {
      void updateRecord(recordId, { musicPptxBlob: undefined, musicSrt: undefined, musicDiagnostics: undefined }, normalizedOwnerEmail);
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

  async function handlePdfUpload(file: File) {
    if (!apiKey) { setToast('請先填入 Gemini API Key'); return; }

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      const msg = '上傳檔案必須為 pdf';
      setStep1State({ status: 'error', error: msg });
      setToast(msg);
      return;
    }

    setPdfFile(file); setStep1State({ status: 'loading' });
    try {
      // @ts-expect-error: bypass remote https import typing
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

      const pdfBase64 = await blobToBase64(file);
      const res = await apiFetch('/api/parse-pdf', { pdf: pdfBase64, textModel });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSlides(data.slides); setStep1State({ status: 'done' });
      const id = `${Date.now()}`; setRecordId(id);
      await saveRecord({
        id,
        pdfName: file.name,
        createdAt: Date.now(),
        ownerEmail: normalizedOwnerEmail,
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
        musicStyle: MUSIC_STYLES.find(s => s.id === styleId)?.label ?? '',
        slides: data.slides,
        pdfBlob: file,
      });
      loadHistory();
      setTimeout(() => step2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) { setStep1State({ status: 'error', error: String(e) }); setToast('PDF 解析失敗：' + String(e)); }
  }

  async function handleGenerateScript() {
    if (!slides) return; setStep2State({ status: 'loading' });
    try {
      const res = await apiFetch('/api/generate-script', {
        slides,
        speaker1: speaker1 || DEFAULT_SPEAKER1,
        speaker2: speaker2 || DEFAULT_SPEAKER2,
        dialogueStyle: dialogueStyle || DEFAULT_DIALOGUE_STYLE,
        tone: tone || DEFAULT_TONE,
        textModel,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json(); setScript(data.script); setStep2State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { script: data.script, speaker1, speaker2, dialogueStyle, tone, textModel }, normalizedOwnerEmail);
      setTimeout(() => step3Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) { setStep2State({ status: 'error', error: String(e) }); setToast('文稿生成失敗：' + String(e)); }
  }

  async function handleGeneratePodcast() {
    if (!script) return; setStep3State({ status: 'loading' });
    try {
      setPodcastInputMode('api');
      const res = await apiFetch('/api/generate-podcast', { script, voice1, voice2, ttsModel });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      resetPodcastDerivedState();
      setPodcastBlob(blob);
      setPodcastSource('api');
      setStep3State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { podcastBlob: blob, podcastSource: 'api', voice1, voice2, ttsModel }, normalizedOwnerEmail);
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
      if (recordId) await updateRecord(recordId, { podcastBlob: blob, podcastSource: 'upload' }, normalizedOwnerEmail);
      setToast(`已上傳音訊：${file.name}`);
      setTimeout(() => step4Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) {
      setStep3State({ status: 'error', error: String(e) });
      setToast('音訊上傳失敗：' + String(e));
    }
  }

  async function handleRepackPodcastPptx() {
    if (!podcastBlob || !pdfFile || !podcastTimings) return;
    setStep4State({ status: 'loading' });
    try {
      const newTimings = shiftTimings(podcastTimings, podcastSrtOffset);
      const pptx = await generatePptx(pdfFile, newTimings, podcastBlob);
      setPodcastPptxBlob(pptx);
      setStep4State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { podcastPptxBlob: pptx }, normalizedOwnerEmail);
      setToast(`已套用平移 (${podcastSrtOffset > 0 ? '+' : ''}${podcastSrtOffset}s) 並重新封裝 Podcast 簡報！`);
    } catch (e) {
      setStep4State({ status: 'error', error: String(e) });
      setToast('重封裝失敗：' + String(e));
    }
  }

  async function handleRepackMusicPptx() {
    if (!musicBlob || !pdfFile || !musicTimings) return;
    setStep7State({ status: 'loading' });
    try {
      const newTimings = shiftTimings(musicTimings, musicSrtOffset);
      const pptx = await generatePptx(pdfFile, newTimings, musicBlob);
      setMusicPptxBlob(pptx);
      setStep7State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { musicPptxBlob: pptx }, normalizedOwnerEmail);
      setToast(`已套用平移 (${musicSrtOffset > 0 ? '+' : ''}${musicSrtOffset}s) 並重新封裝歌曲簡報！`);
    } catch (e) {
      setStep7State({ status: 'error', error: String(e) });
      setToast('重封裝失敗：' + String(e));
    }
  }

  async function handleGeneratePodcastPptx() {
    if (!podcastBlob || !script || !pdfFile) return;
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
      });
      let timings;
      let srt = '';
      let diagnostics: AlignPodcastDiagnostics | null = null;
      if (res.ok) {
        const data = await res.json();
        diagnostics = data.diagnostics ?? null;
        timings = normalizeTimings(data.timings, slideCount, duration);
        srt = data.srt ?? '';
      } else {
        console.warn('API align-podcast failed, falling back to heuristic calculation.', await res.text());
        timings = await calcPodcastTimings(script, slideCount, podcastBlob);
      }

      const pptx = await generatePptx(pdfFile, timings, podcastBlob);
      setPodcastPptxBlob(pptx); setPodcastSrt(srt); setStep4State({ status: 'done' });
      setPodcastDiagnostics(diagnostics);
      setPodcastTimings(timings);
      if (recordId) {
        await updateRecord(recordId, {
          podcastPptxBlob: pptx,
          podcastSrt: srt,
          podcastDiagnostics: diagnostics ?? undefined,
          podcastTimings: timings,
          multimodalModel,
          textModel,
          step41Model: multimodalModel,
          step42Model: textModel,
        }, normalizedOwnerEmail);
      }
      setToast('Podcast 簡報已生成！'); loadHistory();
      setTimeout(() => step5Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) {
      setStep4State({ status: 'error', error: String(e) }); setToast('Podcast 簡報生成失敗：' + String(e));
    }
  }

  async function handleGenerateLyrics() {
    if (!script) return; setStep5State({ status: 'loading' });
    try {
      const res = await apiFetch('/api/generate-lyrics', { script, styleId, duration: lyricsDuration, textModel });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json(); setLyrics(data.lyrics); setStep5State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { lyrics: data.lyrics, styleId, lyricsDuration, musicStyle: MUSIC_STYLES.find(s => s.id === styleId)?.label ?? '', textModel }, normalizedOwnerEmail);
      setTimeout(() => step6Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) { setStep5State({ status: 'error', error: String(e) }); setToast('歌詞生成失敗：' + String(e)); }
  }

  async function handleGenerateMusic() {
    if (!lyrics) return; setStep6State({ status: 'loading' });
    try {
      setMusicInputMode('api');
      const res = await apiFetch('/api/generate-music', { lyrics, styleId, duration: lyricsDuration, musicModel });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      resetMusicDerivedState();
      setMusicBlob(blob);
      setMusicSource('api');
      setStep6State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { musicBlob: blob, musicSource: 'api', musicModel }, normalizedOwnerEmail);
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
      if (recordId) await updateRecord(recordId, { musicBlob: blob, musicSource: 'upload' }, normalizedOwnerEmail);
      setToast(`已上傳音樂：${file.name}`);
      setTimeout(() => step7Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) {
      setStep6State({ status: 'error', error: String(e) });
      setToast('音樂上傳失敗：' + String(e));
    }
  }

  async function handleGenerateMusicPptx() {
    if (!musicBlob || !lyrics || !pdfFile) return;
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
      });
      let timings;
      let srt = '';
      let diagnostics: AlignMusicDiagnostics | null = null;
      if (res.ok) {
        const data = await res.json();
        diagnostics = data.diagnostics ?? null;
        timings = Array.isArray(data.timings) && data.timings.length > 0
          ? normalizeTimings(data.timings, slideCount, duration)
          : await calcMusicTimings(slideCount, musicBlob, lyrics);
        srt = data.srt ?? '';
      } else {
        console.warn('API align-music failed, falling back to heuristic calculation.', await res.text());
        timings = await calcMusicTimings(slideCount, musicBlob, lyrics);
      }

      const pptx = await generatePptx(pdfFile, timings, musicBlob);
      setMusicPptxBlob(pptx); setMusicSrt(srt); setStep7State({ status: 'done' });
      setMusicDiagnostics(diagnostics);
      setMusicTimings(timings);
      if (recordId) {
        await updateRecord(recordId, {
          musicPptxBlob: pptx,
          musicSrt: srt,
          musicDiagnostics: diagnostics ?? undefined,
          musicTimings: timings,
          multimodalModel,
          textModel,
          step71Model: multimodalModel,
          step72Model: textModel,
        }, normalizedOwnerEmail);
      }
      setToast('音樂簡報已生成！'); loadHistory();
    } catch (e) {
      setStep7State({ status: 'error', error: String(e) }); setToast('音樂簡報生成失敗：' + String(e));
    }
  }

  function loadRecord(rec: GenerationRecord) {
    if (rec.speaker1) setSpeaker1(rec.speaker1); if (rec.speaker2) setSpeaker2(rec.speaker2);
    if (rec.dialogueStyle) setDialogueStyle(rec.dialogueStyle); if (rec.tone) setTone(rec.tone);
    if (rec.voice1) setVoice1(rec.voice1); if (rec.voice2) setVoice2(rec.voice2);
    if (rec.multimodalModel) setMultimodalModel(rec.multimodalModel);
    else if (rec.step41Model) setMultimodalModel(rec.step41Model);
    else if (rec.step71Model) setMultimodalModel(rec.step71Model);
    else setMultimodalModel(DEFAULT_MULTIMODAL_MODEL);
    const savedTextModel = rec.textModel ?? rec.step42Model ?? rec.step72Model;
    if (savedTextModel === DEFAULT_LOCAL_TEXT_MODEL && !localLlmEnabled) setTextModel(DEFAULT_TEXT_MODEL);
    else if (savedTextModel) setTextModel(savedTextModel);
    else setTextModel(localLlmEnabled ? DEFAULT_LOCAL_TEXT_MODEL : DEFAULT_TEXT_MODEL);
    if (rec.ttsModel) setTtsModel(rec.ttsModel);
    if (rec.musicModel) setMusicModel(rec.musicModel);
    if (rec.styleId) setStyleId(rec.styleId); if (rec.lyricsDuration) setLyricsDuration(rec.lyricsDuration);
    if (rec.pdfBlob) setPdfFile(new File([rec.pdfBlob], rec.pdfName, { type: 'application/pdf' }));
    if (rec.slides) { setSlides(rec.slides); setStep1State({ status: 'done' }); }
    if (rec.script) { setScript(rec.script); setStep2State({ status: 'done' }); }
    if (rec.podcastBlob) { setPodcastBlob(rec.podcastBlob); setStep3State({ status: 'done' }); }
    setPodcastInputMode(rec.podcastSource ?? 'api');
    setPodcastSource(rec.podcastSource ?? 'api');
    if (rec.podcastPptxBlob) { setPodcastPptxBlob(rec.podcastPptxBlob); setStep4State({ status: 'done' }); }
    if (rec.lyrics) { setLyrics(rec.lyrics); setStep5State({ status: 'done' }); }
    if (rec.musicBlob) { setMusicBlob(rec.musicBlob); setStep6State({ status: 'done' }); }
    setMusicInputMode(rec.musicSource ?? 'api');
    setMusicSource(rec.musicSource ?? 'api');
    if (rec.musicPptxBlob) { setMusicPptxBlob(rec.musicPptxBlob); setStep7State({ status: 'done' }); }
    if (rec.podcastSrt) setPodcastSrt(rec.podcastSrt); else setPodcastSrt('');
    if (rec.podcastDiagnostics) setPodcastDiagnostics(rec.podcastDiagnostics); else setPodcastDiagnostics(null);
    if (rec.podcastTimings) setPodcastTimings(rec.podcastTimings); else setPodcastTimings(null);
    if (rec.musicSrt) setMusicSrt(rec.musicSrt); else setMusicSrt('');
    if (rec.musicDiagnostics) setMusicDiagnostics(rec.musicDiagnostics); else setMusicDiagnostics(null);
    if (rec.musicTimings) setMusicTimings(rec.musicTimings); else setMusicTimings(null);
    setRecordId(rec.id); setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' }); setToast(`已載入：${rec.pdfName}`);
  }

  function handleNewProject() {
    setPdfFile(null); setSlides(''); setScript(''); setLyrics('');
    setPodcastBlob(null); setMusicBlob(null); setPodcastPptxBlob(null); setMusicPptxBlob(null);
    setPodcastInputMode('api');
    setPodcastSource('api');
    setMusicInputMode('api');
    setMusicSource('api');
    setPodcastSrt(''); setMusicSrt('');
    setPodcastDiagnostics(null);
    setMusicDiagnostics(null);
    setPodcastSrtOffset(0);
    setMusicSrtOffset(0);
    setPodcastTimings(null);
    setMusicTimings(null);
    setStep1State({ status: 'idle' }); setStep2State({ status: 'idle' }); setStep3State({ status: 'idle' });
    setStep4State({ status: 'idle' }); setStep5State({ status: 'idle' });
    setStep6State({ status: 'idle' }); setStep7State({ status: 'idle' });
    setPptxLoading(false); setRecordId('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.type === 'application/pdf') handlePdfUpload(file);
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
          </div>

          {/* Speakers + style fields — wider grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              { label: 'Speaker 1', val: speaker1, set: setSpeaker1, ph: '男生為節目主持人' },
              { label: 'Speaker 2', val: speaker2, set: setSpeaker2, ph: '女生為 Mary 老師' },
              { label: '對話形式', val: dialogueStyle, set: setDialogueStyle, ph: '自然流暢的對話' },
              { label: '語氣風格', val: tone, set: setTone, ph: '親切、易懂' },
            ].map(({ label, val, set, ph }) => (
              <div key={label}>
                <label className={labelCls}>{label}</label>
                <input type="text" value={val} onChange={e => set(e.target.value)} placeholder={ph} className={inputCls} />
              </div>
            ))}
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
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={labelCls.replace('mb-1', '')}>Voice 2</label>
                <button onClick={() => new Audio(voiceSampleUrl(voice2)).play()} className={`text-[10px] font-bold ${dark ? 'text-emerald-500' : 'text-emerald-700'} hover:opacity-70`}>▶試聽</button>
              </div>
              <select value={voice2} onChange={e => setVoice2(e.target.value)} className={selectCls}>
                {VOICES.map(v => <option key={v.name} value={v.name}>{v.name} — {v.desc}</option>)}
              </select>
            </div>
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
                {MULTIMODAL_MODEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Step 2 / 4.2 / 5 / 7.2 模型</label>
              <select value={textModel} onChange={e => setTextModel(e.target.value)} className={selectCls}>
                  {textModelOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
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
          <p className={`mt-3 text-[11px] leading-relaxed ${t.faint}`}>
            第一組用於 PDF 與 audio 這類多模態理解；第二組用於純文字推理與對齊。只有在已設定 `LOCAL_LLM_*` 時，第二組才會出現 <span className="font-semibold">{localLlmLabel}</span>。
          </p>
        </div>

        {/* ── Step 1: Upload PDF ── */}
        <StepCard step={1} title="上傳 PDF" state={step1State} dark={dark}>
          <div
            className={`border-2 border-dashed rounded-2xl p-7 text-center cursor-pointer transition-all ${dragging ? 'border-emerald-600 bg-emerald-900/10' : t.dropzone
              }`}
            onClick={() => document.getElementById('pdf-input')?.click()}
          >
            <input id="pdf-input" type="file" accept=".pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfUpload(f); }} />
            {step1State.status === 'loading' ? (
              <LoadingBar message="正在解析 PDF 投影片..." dark={dark} />
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
                <p className={`text-[11px] ${t.faint}`}>建議 3-15 頁</p>
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
          <StepCard step={2} title="生成 Podcast 文稿" state={step2State} disabled={!slides} dark={dark}>
            {step2State.status === 'loading'
              ? <LoadingBar message="正在生成雙人對話文稿..." dark={dark} />
              : <ActionBtn onClick={handleGenerateScript}>{step2State.status === 'done' ? '重新生成文稿' : '生成文稿'}</ActionBtn>}
            {script && step2State.status === 'done' && (
              <div className="mt-3 space-y-2">
                <TextBlock text={script} dark={dark} />
                <DownloadChip label="script.txt" onClick={() => downloadText(script, 'script.txt')} dark={dark} />
              </div>
            )}
            {step2State.error && <p className={errBox}>{step2State.error}</p>}
          </StepCard>
        </div>

        {/* ── Step 3 ── */}
        <div ref={step3Ref}>
          <StepCard step={3} title="生成 Podcast 音訊" state={step3State} disabled={!script} dark={dark}>
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
              ? <LoadingBar message={podcastInputMode === 'api' ? '正在生成雙人 TTS 音訊（約 30–60 秒）...' : '正在匯入音訊檔案...'} dark={dark} />
              : podcastInputMode === 'api' ? (
                <ActionBtn onClick={handleGeneratePodcast}>{step3State.status === 'done' && podcastInputMode === 'api' ? '重新生成 Podcast' : '生成 Podcast 音訊'}</ActionBtn>
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
                <DownloadChip label={getPodcastDownloadName(podcastBlob)} onClick={() => downloadBlob(podcastBlob, getPodcastDownloadName(podcastBlob))} dark={dark} />
              </div>
            )}
            {step3State.error && <p className={errBox}>{step3State.error}</p>}
          </StepCard>
        </div>

        {/* ── Step 4 ── */}
        <div ref={step4Ref}>
          <StepCard step={4} title="生成 Podcast 簡報 (AI 精準對齊)" state={step4State} disabled={!podcastBlob || !script} dark={dark}>
            {step4State.status === 'loading'
              ? <LoadingBar message="AI 正在聆聽 Podcast 並標記轉場時間（可能需要 20-40 秒）..." dark={dark} />
              : (
                <div className="space-y-3">
                  <ActionBtn onClick={handleGeneratePodcastPptx}>{step4State.status === 'done' ? '重新生成 Podcast 簡報' : '生成 Podcast 簡報'}</ActionBtn>
                  <p className={`text-[11px] leading-relaxed ${t.faint}`}>
                    對齊時會同時使用 Podcast 音訊與 Step 2 文稿，因此外部上傳音訊前也需要先保留對應文稿。
                  </p>
                </div>
              )}
            {podcastPptxBlob && step4State.status === 'done' && (
              <div className="mt-3 space-y-2">
                <p className={`text-[11px] font-medium ${dark ? 'text-emerald-400' : 'text-emerald-700'}`}>✓ 語音畫面完美同步！</p>
                {podcastDiagnostics && (
                  <p className={`text-[11px] ${t.faint}`}>
                    ASR 模式：{podcastDiagnostics.asrMode} ／ 字幕來源：{podcastDiagnostics.srtSource} ／ 對齊來源：{podcastDiagnostics.timingSource}
                  </p>
                )}
                <DownloadChip label="podcast_slides.pptx" onClick={() => downloadBlob(podcastPptxBlob, 'podcast_slides.pptx')} dark={dark} />
                {podcastSrt && (
                  <div className="inline-flex items-center">
                    <DownloadChip label="podcast.srt" onClick={() => downloadText(adjustSrtTimes(podcastSrt, podcastSrtOffset), 'podcast.srt')} dark={dark} />
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
            {step4State.error && <p className={errBox}>{step4State.error}</p>}
          </StepCard>
        </div>

        {/* ── Step 5 ── */}
        <div ref={step5Ref}>
          <StepCard step={5} title="生成歌詞" state={step5State} disabled={!script} dark={dark}>
            {step5State.status === 'loading'
              ? <LoadingBar message="正在生成歌詞..." dark={dark} />
              : <ActionBtn onClick={handleGenerateLyrics}>{step5State.status === 'done' ? '重新生成歌詞' : '生成歌詞'}</ActionBtn>}
            {lyrics && step5State.status === 'done' && (
              <div className="mt-3 space-y-2">
                <TextBlock text={lyrics} dark={dark} />
                <DownloadChip label="lyrics.txt" onClick={() => downloadText(lyrics, 'lyrics.txt')} dark={dark} />
              </div>
            )}
            {step5State.error && <p className={errBox}>{step5State.error}</p>}
          </StepCard>
        </div>

        {/* ── Step 6 ── */}
        <div ref={step6Ref}>
          <StepCard step={6} title="生成歌曲音訊" state={step6State} disabled={!lyrics} dark={dark}>
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
                <ActionBtn onClick={handleGenerateMusic}>{step6State.status === 'done' && musicInputMode === 'api' ? '重新生成歌曲' : '生成歌曲音訊'}</ActionBtn>
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
                <DownloadChip label="music.mp3" onClick={() => downloadBlob(musicBlob, 'music.mp3')} dark={dark} />
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
          <StepCard step={7} title="生成歌曲簡報 (AI 精準對齊)" state={step7State} disabled={!musicBlob} dark={dark}>
            {step7State.status === 'loading'
              ? <LoadingBar message="AI 正在聆聽歌曲結構並標記轉場時間（可能需要 20-40 秒）..." dark={dark} />
              : <ActionBtn onClick={handleGenerateMusicPptx}>{step7State.status === 'done' ? '重新生成歌曲簡報' : '生成歌曲簡報'}</ActionBtn>}
            {musicPptxBlob && step7State.status === 'done' && (
              <div className="mt-3 space-y-2">
                <p className={`text-[11px] font-medium ${dark ? 'text-emerald-400' : 'text-emerald-700'}`}>✓ 歌曲段落畫面同步！</p>
                {musicDiagnostics && (
                  <p className={`text-[11px] ${t.faint}`}>
                    ASR 模式：{musicDiagnostics.asrMode} ／ 字幕來源：{musicDiagnostics.srtSource} ／ 對齊來源：{musicDiagnostics.timingSource}
                  </p>
                )}
                <DownloadChip label="music_slides.pptx" onClick={() => downloadBlob(musicPptxBlob, 'music_slides.pptx')} dark={dark} />
                {musicSrt && (
                  <div className="inline-flex items-center">
                    <DownloadChip label="music.srt" onClick={() => downloadText(adjustSrtTimes(musicSrt, musicSrtOffset), 'music.srt')} dark={dark} />
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
            {step7State.error && <p className={errBox}>{step7State.error}</p>}
          </StepCard>
        </div>

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
                  { label: 'script.txt', avail: !!script, fn: () => script && downloadText(script, 'script.txt') },
                  { label: 'lyrics.txt', avail: !!lyrics, fn: () => lyrics && downloadText(lyrics, 'lyrics.txt') },
                  { label: 'podcast.srt', avail: !!podcastSrt, fn: () => podcastSrt && downloadText(adjustSrtTimes(podcastSrt, podcastSrtOffset), 'podcast.srt') },
                  { label: 'music.srt', avail: !!musicSrt, fn: () => musicSrt && downloadText(adjustSrtTimes(musicSrt, musicSrtOffset), 'music.srt') },
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
                  { label: podcastBlob ? getPodcastDownloadName(podcastBlob) : 'podcast.mp3', avail: !!podcastBlob, load: false, fn: () => podcastBlob && downloadBlob(podcastBlob, getPodcastDownloadName(podcastBlob)) },
                  { label: 'music.mp3', avail: !!musicBlob, load: false, fn: () => musicBlob && downloadBlob(musicBlob, 'music.mp3') },
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
                  { label: 'podcast_slides.pptx', avail: !!podcastPptxBlob, load: pptxLoading, fn: () => podcastPptxBlob && downloadBlob(podcastPptxBlob, 'podcast_slides.pptx') },
                  { label: 'music_slides.pptx', avail: !!musicPptxBlob, load: pptxLoading, fn: () => musicPptxBlob && downloadBlob(musicPptxBlob, 'music_slides.pptx') },
                ].map(({ label, avail, load, fn }) => (
                  <button key={label} onClick={fn} disabled={!avail && !load}
                    className={`flex items-center justify-center gap-1 px-2 py-2 rounded-xl text-[11px] font-semibold border transition-all ${t.dlBtn(avail, load)}`}>
                    {load ? '⏳' : avail ? '⬇' : '🔒'} {label}
                  </button>
                ))}
              </div>
            </div>
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
                      {rec.script && <button onClick={() => downloadText(rec.script!, 'script.txt')} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓script</button>}
                      {rec.lyrics && <button onClick={() => downloadText(rec.lyrics!, 'lyrics.txt')} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓lyrics</button>}
                      {rec.podcastBlob && <button onClick={() => downloadBlob(rec.podcastBlob!, getPodcastDownloadName(rec.podcastBlob!))} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓{getPodcastDownloadName(rec.podcastBlob!)}</button>}
                      {rec.musicBlob && <button onClick={() => downloadBlob(rec.musicBlob!, 'music.mp3')} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓music</button>}
                      {rec.podcastPptxBlob && <button onClick={() => downloadBlob(rec.podcastPptxBlob!, 'podcast_slides.pptx')} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓pptx</button>}
                      {rec.musicPptxBlob && <button onClick={() => downloadBlob(rec.musicPptxBlob!, 'music_slides.pptx')} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓music.pptx</button>}
                      {rec.podcastSrt && <button onClick={() => downloadText(rec.podcastSrt!, 'podcast.srt')} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-amber-400 bg-amber-900/30 hover:bg-amber-900/50' : 'text-amber-700 bg-amber-50 hover:bg-amber-100'}`}>↓podcast.srt</button>}
                      {rec.musicSrt && <button onClick={() => downloadText(rec.musicSrt!, 'music.srt')} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-amber-400 bg-amber-900/30 hover:bg-amber-900/50' : 'text-amber-700 bg-amber-50 hover:bg-amber-100'}`}>↓music.srt</button>}
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
          <span className={`text-[11px] ${t.faint}`}>Powered by <span className={`font-semibold ${dark ? 'text-slate-300' : 'text-slate-500'}`}>NCHC</span></span>
        </div>
      </footer>
    </div>
  );
}
