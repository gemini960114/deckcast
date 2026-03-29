'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { setUnauthorizedHandler, apiFetch } from '@/lib/apiFetch';
import { generatePptx } from '@/lib/generatePptx';
import { calcPodcastTimings, calcMusicTimings } from '@/lib/timing';
import { saveRecord, updateRecord, getAllRecords, deleteRecord } from '@/lib/db';
import type { GenerationRecord, StepState } from '@/lib/types';
import { MUSIC_STYLES, VOICES } from '@/lib/types';
import {
  SESSION_KEY,
  DEFAULT_SPEAKER1, DEFAULT_SPEAKER2, DEFAULT_DIALOGUE_STYLE, DEFAULT_TONE,
  DEFAULT_VOICE1, DEFAULT_VOICE2, DEFAULT_STYLE_ID, DEFAULT_LYRICS_DURATION,
  LYRICS_DURATIONS, voiceSampleUrl,
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

// ── theme tokens ──
function useTheme(dark: boolean) {
  return {
    page:       dark ? 'bg-slate-900 text-slate-200'       : 'bg-slate-100 text-slate-800',
    header:     dark ? 'bg-slate-900/90 border-slate-700'  : 'bg-white/90 border-slate-200',
    card:       dark ? 'bg-slate-800 border-slate-700'     : 'bg-white border-slate-200',
    cardDone:   dark ? 'bg-slate-800 border-emerald-700'   : 'bg-white border-emerald-600',
    cardLoad:   dark ? 'bg-slate-800 border-emerald-600'   : 'bg-white border-emerald-500',
    cardErr:    dark ? 'bg-slate-800 border-red-500'       : 'bg-white border-red-400',
    inner:      dark ? 'bg-slate-900 border-slate-700'     : 'bg-slate-50 border-slate-100',
    input:      dark ? 'bg-slate-900 border-slate-600 text-slate-200 placeholder:text-slate-600' : 'bg-white border-slate-200 text-slate-700 placeholder:text-slate-300',
    select:     dark ? 'bg-slate-900 border-slate-600 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-700',
    label:      dark ? 'text-slate-500' : 'text-slate-400',
    muted:      dark ? 'text-slate-400' : 'text-slate-500',
    faint:      dark ? 'text-slate-500' : 'text-slate-400',
    text:       dark ? 'text-slate-200' : 'text-slate-700',
    heading:    dark ? 'text-slate-100' : 'text-slate-800',
    green:      dark ? 'text-emerald-400' : 'text-emerald-700',
    greenBg:    dark ? 'bg-emerald-900/40 border-emerald-800' : 'bg-emerald-50 border-emerald-200',
    greenChip:  dark ? 'bg-emerald-900/50 text-emerald-400 border-emerald-800' : 'bg-emerald-50 text-emerald-700 border-emerald-200',
    badge:      dark ? 'bg-emerald-700 text-white' : 'bg-emerald-700 text-white',
    badgeLoad:  dark ? 'bg-emerald-600 text-white' : 'bg-emerald-600 text-white',
    badgeErr:   dark ? 'bg-red-600 text-white'     : 'bg-red-500 text-white',
    badgeIdle:  dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-500',
    mono:       dark ? 'bg-slate-900 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-600',
    drawer:     dark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-100',
    drawerItem: dark ? 'bg-slate-800 border-slate-700 hover:border-emerald-700' : 'bg-slate-50 border-slate-100 hover:border-emerald-300',
    dropzone:   dark ? 'border-slate-600 hover:border-emerald-600 hover:bg-emerald-900/20' : 'border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40',
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
    state.status === 'done'    ? t.cardDone :
    state.status === 'loading' ? t.cardLoad :
    state.status === 'error'   ? t.cardErr  : t.card;
  const badge =
    state.status === 'done'    ? t.badge :
    state.status === 'loading' ? t.badgeLoad :
    state.status === 'error'   ? t.badgeErr  : t.badgeIdle;

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
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-all ${
        dark ? 'text-emerald-400 bg-emerald-900/30 border-emerald-800 hover:bg-emerald-800/60'
             : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
      }`}>
      <span style={{ fontSize: 12 }}>↓</span>{label}
    </button>
  );
}

// ═══════════════════════════════════════════
export default function Home() {
  const [dark, setDark] = useState(true);

  const [apiKey, setApiKey] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [speaker1, setSpeaker1] = useState(DEFAULT_SPEAKER1);
  const [speaker2, setSpeaker2] = useState(DEFAULT_SPEAKER2);
  const [dialogueStyle, setDialogueStyle] = useState(DEFAULT_DIALOGUE_STYLE);
  const [tone, setTone] = useState(DEFAULT_TONE);
  const [voice1, setVoice1] = useState<string>(DEFAULT_VOICE1);
  const [voice2, setVoice2] = useState<string>(DEFAULT_VOICE2);
  const [styleId, setStyleId] = useState(DEFAULT_STYLE_ID);
  const [lyricsDuration, setLyricsDuration] = useState(DEFAULT_LYRICS_DURATION);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [slides, setSlides] = useState('');
  const [script, setScript] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [podcastBlob, setPodcastBlob] = useState<Blob | null>(null);
  const [musicBlob, setMusicBlob] = useState<Blob | null>(null);
  const [podcastPptxBlob, setPodcastPptxBlob] = useState<Blob | null>(null);
  const [musicPptxBlob, setMusicPptxBlob] = useState<Blob | null>(null);
  const [step1State, setStep1State] = useState<StepState>({ status: 'idle' });
  const [step2State, setStep2State] = useState<StepState>({ status: 'idle' });
  const [step3State, setStep3State] = useState<StepState>({ status: 'idle' });
  const [step4State, setStep4State] = useState<StepState>({ status: 'idle' });
  const [step5State, setStep5State] = useState<StepState>({ status: 'idle' });
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

  const t = useTheme(dark);

  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) { setApiKey(saved); setApiKeyInput(saved); }
    setUnauthorizedHandler(() => { setApiKey(''); setApiKeyInput(''); setToast('API Key 無效，請重新輸入'); });
    loadHistory();
  }, []);

  async function loadHistory() { setHistory(await getAllRecords()); }

  function saveApiKey() {
    const key = apiKeyInput.trim(); if (!key) return;
    sessionStorage.setItem(SESSION_KEY, key); setApiKey(key); setToast('API Key 已儲存');
  }
  function clearApiKey() {
    sessionStorage.removeItem(SESSION_KEY); setApiKey(''); setApiKeyInput(''); setToast('API Key 已清除');
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
      // @ts-ignore: bypass remote https import typing
      const pdfjsLib = await import(/* webpackIgnore: true */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/pdf.worker.min.mjs';
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      if (pdfDoc.numPages < 5 || pdfDoc.numPages > 10) {
        const msg = '請上傳 5-10 頁的範圍簡報檔案';
        setStep1State({ status: 'error', error: msg });
        setToast(msg);
        return;
      }

      const pdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject; reader.readAsDataURL(file);
      });
      const res = await apiFetch('/api/parse-pdf', { pdf: pdfBase64 });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSlides(data.slides); setStep1State({ status: 'done' });
      const id = `${Date.now()}`; setRecordId(id);
      await saveRecord({ id, pdfName: file.name, createdAt: Date.now(), speaker1, speaker2, dialogueStyle, tone, voice1, voice2, styleId, lyricsDuration, musicStyle: MUSIC_STYLES.find(s => s.id === styleId)?.label ?? '', slides: data.slides, pdfBlob: file });
      loadHistory();
      setTimeout(() => step2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) { setStep1State({ status: 'error', error: String(e) }); setToast('PDF 解析失敗：' + String(e)); }
  }

  async function handleGenerateScript() {
    if (!slides) return; setStep2State({ status: 'loading' });
    try {
      const res = await apiFetch('/api/generate-script', { slides, speaker1: speaker1 || DEFAULT_SPEAKER1, speaker2: speaker2 || DEFAULT_SPEAKER2, dialogueStyle: dialogueStyle || DEFAULT_DIALOGUE_STYLE, tone: tone || DEFAULT_TONE });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json(); setScript(data.script); setStep2State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { script: data.script, speaker1, speaker2, dialogueStyle, tone });
      setTimeout(() => step3Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) { setStep2State({ status: 'error', error: String(e) }); setToast('文稿生成失敗：' + String(e)); }
  }

  async function handleGenerateLyrics() {
    if (!script) return; setStep3State({ status: 'loading' });
    try {
      const res = await apiFetch('/api/generate-lyrics', { script, styleId, duration: lyricsDuration });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json(); setLyrics(data.lyrics); setStep3State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { lyrics: data.lyrics, styleId, lyricsDuration, musicStyle: MUSIC_STYLES.find(s => s.id === styleId)?.label ?? '' });
      setTimeout(() => step4Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) { setStep3State({ status: 'error', error: String(e) }); setToast('歌詞生成失敗：' + String(e)); }
  }

  async function handleGeneratePodcast() {
    if (!script) return; setStep4State({ status: 'loading' });
    try {
      const res = await apiFetch('/api/generate-podcast', { script, voice1, voice2 });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob(); setPodcastBlob(blob); setStep4State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { podcastBlob: blob, voice1, voice2 });
      setTimeout(() => step5Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (e) { setStep4State({ status: 'error', error: String(e) }); setToast('Podcast 音訊生成失敗：' + String(e)); }
  }

  async function handleGenerateMusic() {
    if (!lyrics) return; setStep5State({ status: 'loading' });
    try {
      const res = await apiFetch('/api/generate-music', { lyrics, styleId });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob(); setMusicBlob(blob); setStep5State({ status: 'done' });
      if (recordId) await updateRecord(recordId, { musicBlob: blob });
      if (podcastBlob && script && pdfFile) generatePptxInBackground(blob);
    } catch (e) {
      const msg = String(e); const isBlocked = msg.includes('PROHIBITED_CONTENT');
      setStep5State({ status: 'error', error: isBlocked ? 'PROHIBITED_CONTENT：歌詞觸發內容審核，請重新生成歌詞後再試' : msg });
      setToast(isBlocked ? '歌詞觸發內容審核，請重新生成歌詞' : '音樂生成失敗：' + msg);
    }
  }

  const generatePptxInBackground = useCallback(async (mBlob: Blob) => {
    if (!podcastBlob || !script || !pdfFile) return;
    setPptxLoading(true);
    try {
      const slideCount = (slides.match(/投影片\s*\d+/g) ?? []).length || 5;
      const [podcastTimings, musicTimings] = await Promise.all([calcPodcastTimings(script, slideCount, podcastBlob), calcMusicTimings(slideCount, mBlob, lyrics)]);
      const [pPptx, mPptx] = await Promise.all([generatePptx(pdfFile, podcastTimings, podcastBlob), generatePptx(pdfFile, musicTimings, mBlob)]);
      setPodcastPptxBlob(pPptx); setMusicPptxBlob(mPptx);
      if (recordId) await updateRecord(recordId, { podcastPptxBlob: pPptx, musicPptxBlob: mPptx });
      setToast('簡報已準備好，可下載'); loadHistory();
    } catch (e) { setToast('PPTX 生成失敗：' + String(e)); }
    finally { setPptxLoading(false); }
  }, [podcastBlob, script, slides, lyrics, pdfFile, recordId]);

  useEffect(() => {
    if (step4State.status === 'done' && step5State.status === 'done' && musicBlob && !podcastPptxBlob)
      generatePptxInBackground(musicBlob);
  }, [step4State.status, step5State.status, musicBlob, podcastPptxBlob, generatePptxInBackground]);

  function loadRecord(rec: GenerationRecord) {
    if (rec.speaker1) setSpeaker1(rec.speaker1); if (rec.speaker2) setSpeaker2(rec.speaker2);
    if (rec.dialogueStyle) setDialogueStyle(rec.dialogueStyle); if (rec.tone) setTone(rec.tone);
    if (rec.voice1) setVoice1(rec.voice1); if (rec.voice2) setVoice2(rec.voice2);
    if (rec.styleId) setStyleId(rec.styleId); if (rec.lyricsDuration) setLyricsDuration(rec.lyricsDuration);
    if (rec.pdfBlob) setPdfFile(new File([rec.pdfBlob], rec.pdfName, { type: 'application/pdf' }));
    if (rec.slides)          { setSlides(rec.slides);           setStep1State({ status: 'done' }); }
    if (rec.script)          { setScript(rec.script);           setStep2State({ status: 'done' }); }
    if (rec.lyrics)          { setLyrics(rec.lyrics);           setStep3State({ status: 'done' }); }
    if (rec.podcastBlob)     { setPodcastBlob(rec.podcastBlob); setStep4State({ status: 'done' }); }
    if (rec.musicBlob)       { setMusicBlob(rec.musicBlob);     setStep5State({ status: 'done' }); }
    if (rec.podcastPptxBlob) setPodcastPptxBlob(rec.podcastPptxBlob);
    if (rec.musicPptxBlob)   setMusicPptxBlob(rec.musicPptxBlob);
    setRecordId(rec.id); setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' }); setToast(`已載入：${rec.pdfName}`);
  }

  function handleNewProject() {
    setPdfFile(null); setSlides(''); setScript(''); setLyrics('');
    setPodcastBlob(null); setMusicBlob(null); setPodcastPptxBlob(null); setMusicPptxBlob(null);
    setStep1State({ status: 'idle' }); setStep2State({ status: 'idle' }); setStep3State({ status: 'idle' });
    setStep4State({ status: 'idle' }); setStep5State({ status: 'idle' }); setPptxLoading(false); setRecordId('');
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
              <rect width="32" height="32" rx="7" fill="#047857"/>
              <rect x="4" y="9" width="15" height="11" rx="2" fill="white"/>
              <rect x="6" y="12" width="8" height="1.5" rx="0.75" fill="#047857" opacity="0.45"/>
              <rect x="6" y="15" width="5" height="1.5" rx="0.75" fill="#047857" opacity="0.45"/>
              <path d="M22 13.5 Q25.5 16 22 18.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round"/>
              <path d="M24.5 11 Q29.5 16 24.5 21" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.55"/>
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
            {/* Dark / Light toggle */}
            <button
              onClick={() => setDark(d => !d)}
              title={dark ? '切換白天模式' : '切換夜晚模式'}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-base border transition-all ${
                dark ? 'bg-slate-700 border-slate-600 hover:bg-slate-600' : 'bg-slate-100 border-slate-200 hover:bg-slate-200'
              }`}
            >{dark ? '☀️' : '🌙'}</button>
            <button onClick={handleNewProject}
              className="text-[11px] font-bold text-white emerald-gradient px-4 py-1.5 rounded-full shadow-sm shadow-emerald-900/30 active:scale-95 transition-all">
              ＋ 新專案
            </button>
            <button onClick={() => { setDrawerOpen(true); loadHistory(); }}
              className={`text-[11px] font-semibold border rounded-full px-4 py-1.5 transition-all ${
                dark ? 'text-slate-400 border-slate-600 hover:text-emerald-400 hover:border-emerald-700'
                     : 'text-slate-500 border-slate-200 hover:text-emerald-700 hover:border-emerald-400'
              }`}>
              歷史紀錄
            </button>
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
                {LYRICS_DURATIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ── Step 1: Upload PDF ── */}
        <StepCard step={1} title="上傳 PDF" state={step1State} dark={dark}>
          <div
            className={`border-2 border-dashed rounded-2xl p-7 text-center cursor-pointer transition-all ${
              dragging ? 'border-emerald-600 bg-emerald-900/10' : t.dropzone
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
                <p className={`text-[11px] ${t.faint}`}>建議 5–10 頁</p>
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
          <StepCard step={3} title="生成歌詞" state={step3State} disabled={!script} dark={dark}>
            {step3State.status === 'loading'
              ? <LoadingBar message="正在生成歌詞..." dark={dark} />
              : <ActionBtn onClick={handleGenerateLyrics}>{step3State.status === 'done' ? '重新生成歌詞' : '生成歌詞'}</ActionBtn>}
            {lyrics && step3State.status === 'done' && (
              <div className="mt-3 space-y-2">
                <TextBlock text={lyrics} dark={dark} />
                <DownloadChip label="lyrics.txt" onClick={() => downloadText(lyrics, 'lyrics.txt')} dark={dark} />
              </div>
            )}
            {step3State.error && <p className={errBox}>{step3State.error}</p>}
          </StepCard>
        </div>

        {/* ── Step 4 ── */}
        <div ref={step4Ref}>
          <StepCard step={4} title="生成 Podcast 音訊" state={step4State} disabled={!script} dark={dark}>
            {step4State.status === 'loading'
              ? <LoadingBar message="正在生成雙人 TTS 音訊（約 30–60 秒）..." dark={dark} />
              : <ActionBtn onClick={handleGeneratePodcast}>{step4State.status === 'done' ? '重新生成 Podcast' : '生成 Podcast 音訊'}</ActionBtn>}
            {podcastBlob && step4State.status === 'done' && (
              <div className="mt-3 space-y-2">
                <AudioPlayer blob={podcastBlob} label="Podcast 音訊" dark={dark} />
                <DownloadChip label="podcast.wav" onClick={() => downloadBlob(podcastBlob, 'podcast.mp3')} dark={dark} />
              </div>
            )}
            {step4State.error && <p className={errBox}>{step4State.error}</p>}
          </StepCard>
        </div>

        {/* ── Step 5 ── */}
        <div ref={step5Ref}>
          <StepCard step={5} title="生成歌曲音訊" state={step5State} disabled={!lyrics} dark={dark}>
            {step5State.status === 'loading'
              ? <LoadingBar message="正在生成 AI 歌曲（約 30–60 秒）..." dark={dark} />
              : <ActionBtn onClick={handleGenerateMusic}>{step5State.status === 'done' ? '重新生成歌曲' : '生成歌曲音訊'}</ActionBtn>}
            {musicBlob && step5State.status === 'done' && (
              <div className="mt-3 space-y-2">
                <AudioPlayer blob={musicBlob} label="AI 歌曲" dark={dark} />
                <DownloadChip label="music.mp3" onClick={() => downloadBlob(musicBlob, 'music.mp3')} dark={dark} />
              </div>
            )}
            {step5State.error && (
              <div className="mt-3 space-y-2">
                <p className={errBox}>{step5State.error}</p>
                {step5State.error.includes('PROHIBITED_CONTENT') && (
                  <button onClick={() => { setStep3State({ status: 'idle' }); setLyrics(''); step3Ref.current?.scrollIntoView({ behavior: 'smooth' }); }}
                    className={`text-[11px] font-bold px-4 py-2 rounded-full transition-all ${dark ? 'bg-amber-900/40 text-amber-400 hover:bg-amber-900/60' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
                    ↩ 回到 Step 3 重新生成歌詞
                  </button>
                )}
              </div>
            )}
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
                  { label: 'slides.txt',  avail: !!slides, fn: () => slides && downloadText(slides, 'slides.txt') },
                  { label: 'script.txt',  avail: !!script, fn: () => script && downloadText(script, 'script.txt') },
                  { label: 'lyrics.txt',  avail: !!lyrics, fn: () => lyrics && downloadText(lyrics, 'lyrics.txt') },
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
                  { label: 'podcast.wav', avail: !!podcastBlob, load: false,       fn: () => podcastBlob && downloadBlob(podcastBlob, 'podcast.mp3') },
                  { label: 'music.mp3',   avail: !!musicBlob,   load: false,       fn: () => musicBlob && downloadBlob(musicBlob, 'music.mp3') },
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
                  { label: 'music_slides.pptx',   avail: !!musicPptxBlob,   load: pptxLoading, fn: () => musicPptxBlob && downloadBlob(musicPptxBlob, 'music_slides.pptx') },
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
                      {rec.podcastBlob && <button onClick={() => downloadBlob(rec.podcastBlob!, 'podcast.mp3')} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓podcast</button>}
                      {rec.musicBlob && <button onClick={() => downloadBlob(rec.musicBlob!, 'music.mp3')} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓music</button>}
                      {rec.podcastPptxBlob && <button onClick={() => downloadBlob(rec.podcastPptxBlob!, 'podcast_slides.pptx')} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓pptx</button>}
                      {rec.musicPptxBlob && <button onClick={() => downloadBlob(rec.musicPptxBlob!, 'music_slides.pptx')} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'text-emerald-400 bg-emerald-900/30 hover:bg-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>↓music.pptx</button>}
                      <button onClick={() => { deleteRecord(rec.id); loadHistory(); }}
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
