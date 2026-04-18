'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { pdfToJpegBase64 } from '@/lib/pdfToImages';
import { buildOrderedImagesFromTimings } from '@/lib/generatePptx';
import type { SlideTimings } from '@/lib/types';

interface VideoExportBlockProps {
  title: string;
  pdfBlob: Blob | null;
  audioBlob: Blob | null;
  timings: SlideTimings | null;
  filename: string;
  displayName?: string;
  cachedBlob: Blob | null;
  cachedFilename?: string | null;
  onCached: (blob: Blob, filename: string) => void;
  onClearCache: () => void;
  dark: boolean;
  videoExportEnabled: boolean;
  srtText?: string | null;
}

type ExportStatus = 'idle' | 'rendering' | 'uploading' | 'waiting' | 'error';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 10_000;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getExportFilename(filename: string, burnSubs: boolean) {
  return burnSubs ? filename.replace(/\.mp4$/i, '.subbed.mp4') : filename;
}

export default function VideoExportBlock({
  title,
  pdfBlob,
  audioBlob,
  timings,
  filename,
  displayName,
  cachedBlob,
  cachedFilename,
  onCached,
  onClearCache,
  dark,
  videoExportEnabled,
  srtText,
}: VideoExportBlockProps) {
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [error, setError] = useState('');
  const [forceRegen, setForceRegen] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [burnSubs, setBurnSubs] = useState(false);
  const hasSrt = Boolean(srtText);

  useEffect(() => {
    if (!hasSrt) {
      setBurnSubs(false);
    }
  }, [hasSrt]);

  if (!videoExportEnabled) return null;

  const canGenerate = Boolean(pdfBlob && audioBlob && timings && timings.length > 0);
  const showCached = cachedBlob !== null && status === 'idle' && !forceRegen;

  async function handleGenerate() {
    if (!pdfBlob || !audioBlob || !timings) return;
    setStatus('rendering');
    setError('');
    setRetryCount(0);

    try {
      const allImages = await pdfToJpegBase64(pdfBlob);
      // D14-3: reorder by cue timeline so images.length === timings.length
      const images = buildOrderedImagesFromTimings(allImages, timings);
      setStatus('uploading');
      const audioBase64 = await blobToBase64(audioBlob);
      const exportFilename = getExportFilename(filename, burnSubs && hasSrt);

      let attempt = 0;
      while (true) {
        attempt++;
        const res = await apiFetch('/api/export-video', {
          images,
          timings,
          audioBase64,
          audioMimeType: audioBlob.type || 'audio/wav',
          transition: 'fade',
          resolution: '1080p',
          burnSubs: burnSubs && hasSrt,
          srtText: burnSubs && hasSrt ? srtText : undefined,
        });

        // 503 = server busy → auto-retry with delay
        if (res.status === 503 && attempt <= MAX_RETRIES) {
          setRetryCount(attempt);
          setStatus('waiting');
          await new Promise<void>(r => setTimeout(r, RETRY_DELAY_MS));
          setStatus('uploading');
          continue;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
          throw new Error(data.error ?? '影片合成失敗');
        }

        const blob = await res.blob();
        triggerDownload(blob, exportFilename);
        onCached(blob, exportFilename);
        setStatus('idle');
        setForceRegen(false);
        setRetryCount(0);
        break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  const chipBase = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-semibold transition-all';

  const chipIdle = dark
    ? `${chipBase} bg-slate-700 border-slate-600 text-slate-300 hover:border-blue-500 hover:text-blue-300`
    : `${chipBase} bg-white border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-700`;

  const chipCached = dark
    ? `${chipBase} bg-emerald-900/30 border-emerald-700 text-emerald-400 hover:bg-emerald-900/50`
    : `${chipBase} bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100`;

  const chipLoading = dark
    ? `${chipBase} bg-blue-900/30 border-blue-700 text-blue-300 opacity-60 cursor-wait`
    : `${chipBase} bg-blue-50 border-blue-300 text-blue-700 opacity-60 cursor-wait`;

  const chipWaiting = dark
    ? `${chipBase} bg-amber-900/30 border-amber-700 text-amber-300 opacity-60 cursor-wait`
    : `${chipBase} bg-amber-50 border-amber-300 text-amber-700 opacity-60 cursor-wait`;

  const chipError = dark
    ? `${chipBase} bg-red-900/30 border-red-700 text-red-400 hover:bg-red-900/50`
    : `${chipBase} bg-red-50 border-red-300 text-red-600 hover:bg-red-100`;

  const containerCls = dark
    ? 'rounded-2xl border p-4 bg-slate-800/50 border-slate-700/80'
    : 'rounded-2xl border p-4 bg-slate-50 border-slate-200';

  const regenCls = dark
    ? 'text-[10px] font-medium text-slate-500 hover:text-slate-300 underline cursor-pointer'
    : 'text-[10px] font-medium text-slate-400 hover:text-slate-600 underline cursor-pointer';

  function renderButton() {
    if (showCached) {
      return (
        <button className={chipCached} onClick={() => triggerDownload(cachedBlob!, cachedFilename ?? filename)}>
          ✓ 已生成・再次下載
        </button>
      );
    }
    if (status === 'rendering') {
      return <button className={chipLoading} disabled>⏳ 渲染投影片中…</button>;
    }
    if (status === 'uploading') {
      return <button className={chipLoading} disabled>⏳ 合成影片中（可能需數分鐘）…</button>;
    }
    if (status === 'waiting') {
      return (
        <button className={chipWaiting} disabled>
          ⏳ 伺服器忙碌，10 秒後自動重試（第 {retryCount}/{MAX_RETRIES} 次）…
        </button>
      );
    }
    if (status === 'error') {
      return (
        <button
          className={chipError}
          onClick={() => { setError(''); setRetryCount(0); void handleGenerate(); }}
        >
          重試
        </button>
      );
    }
    return (
      <button
        className={`${chipIdle} ${!canGenerate ? 'opacity-40 cursor-not-allowed' : ''}`}
        disabled={!canGenerate}
        onClick={() => void handleGenerate()}
      >
        ⬇ {displayName ?? filename}
      </button>
    );
  }

  return (
    <div className={containerCls}>
      <div className="flex items-start gap-2 mb-3">
        <span className="text-base leading-none mt-0.5">🎬</span>
        <div>
          <p className={`text-xs font-bold ${dark ? 'text-slate-200' : 'text-slate-700'}`}>{title}</p>
          <p className={`text-[11px] mt-0.5 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            將簡報轉換為 MP4，可上傳 YouTube 或本地播放。
          </p>
        </div>
      </div>

      {hasSrt && (
        <div className="mb-3 space-y-1.5">
          <label className={`flex items-center gap-2 cursor-pointer select-none w-fit ${status !== 'idle' ? 'opacity-40 pointer-events-none' : ''}`}>
            <input
              type="checkbox"
              checked={burnSubs}
              onChange={e => {
                setBurnSubs(e.target.checked);
                onClearCache();
              }}
              className="w-3.5 h-3.5 accent-blue-500"
            />
            <span className={`text-[11px] font-medium ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
              燒入字幕（字幕將永久嵌入畫面）
            </span>
          </label>
          <p className={`text-[10px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            未勾選時會輸出純畫面影片，字幕仍可另外下載 `.srt`。
          </p>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {renderButton()}
        {showCached && (
          <button
            className={regenCls}
            onClick={() => { onClearCache(); setForceRegen(true); void handleGenerate(); }}
          >
            重新生成
          </button>
        )}
      </div>

      {status === 'error' && error && (
        <p className={`mt-2 text-[10px] ${dark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
      )}
    </div>
  );
}
