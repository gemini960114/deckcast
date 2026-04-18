'use client';

import { useState } from 'react';
import type { SrtEntry, SrtSlideCue } from '@/lib/types';
import { pdfToJpegBase64 } from '@/lib/pdfToImages';

interface SrtCueEditorProps {
  srtEntries: SrtEntry[];
  slideCues: SrtSlideCue[];
  slideCount: number;
  onChange: (next: SrtSlideCue[]) => void;
  pdfBlob?: Blob | null;
  dark?: boolean;
}

export default function SrtCueEditor({
  srtEntries,
  slideCues,
  slideCount,
  onChange,
  pdfBlob,
  dark = false,
}: SrtCueEditorProps) {
  const [activeSlide, setActiveSlide] = useState<number | null>(null);
  const [thumbnails, setThumbnails] = useState<string[] | null>(null);
  const [thumbLoading, setThumbLoading] = useState(false);

  const cueMap = new Map<number, number>();
  for (const c of slideCues) cueMap.set(c.srtId, c.slideIndex);

  const missingSlides = getMissingSlides(slideCues, slideCount);

  function handleChipClick(n: number) {
    const next = activeSlide === n ? null : n;
    setActiveSlide(next);

    if (next !== null && pdfBlob && thumbnails === null && !thumbLoading) {
      setThumbLoading(true);
      pdfToJpegBase64(pdfBlob, 0.3)
        .then(imgs => { setThumbnails(imgs); setThumbLoading(false); })
        .catch(() => setThumbLoading(false));
    }
  }

  function assignSlide(srtId: number, slideIndex: number | null) {
    let next: SrtSlideCue[];
    if (slideIndex === null) {
      next = slideCues.filter(c => c.srtId !== srtId);
    } else {
      const existing = slideCues.find(c => c.srtId === srtId);
      if (existing) {
        next = slideCues.map(c => c.srtId === srtId ? { ...c, slideIndex } : c);
      } else {
        next = [...slideCues, { srtId, slideIndex }].sort((a, b) => a.srtId - b.srtId);
      }
    }
    onChange(next);
  }

  function handleRowClick(entry: SrtEntry) {
    if (activeSlide === null) return;
    const current = cueMap.get(entry.id);
    if (current === activeSlide) {
      assignSlide(entry.id, null);
    } else {
      assignSlide(entry.id, activeSlide);
    }
  }

  const border = dark ? 'border-slate-700' : 'border-slate-200';
  const bg = dark ? 'bg-slate-900' : 'bg-slate-50';
  const faint = dark ? 'text-slate-500' : 'text-slate-400';
  const textCls = dark ? 'text-slate-200' : 'text-slate-800';

  return (
    <div className={`rounded-2xl border ${border} p-4 space-y-3`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className={`text-xs font-bold uppercase tracking-widest ${dark ? 'text-sky-400' : 'text-sky-600'}`}>
          換頁標記編輯
        </p>
        {missingSlides.length > 0 && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-100 text-amber-700'}`}>
            ⚠ 缺少 slide {missingSlides.join(', ')} 的標記
          </span>
        )}
      </div>

      {/* Slide chip bar */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveSlide(null)}
          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
            activeSlide === null
              ? dark ? 'bg-slate-600 border-slate-500 text-white' : 'bg-slate-200 border-slate-400 text-slate-700'
              : dark ? 'border-slate-700 text-slate-400 hover:border-slate-500' : 'border-slate-200 text-slate-400 hover:border-slate-400'
          }`}
        >
          瀏覽
        </button>
        {Array.from({ length: slideCount }, (_, i) => i + 1).map(n => {
          const active = activeSlide === n;
          const hasCue = slideCues.some(c => c.slideIndex === n);
          return (
            <button
              key={n}
              onClick={() => handleChipClick(n)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-all ${
                active
                  ? dark ? 'bg-sky-700 border-sky-500 text-white' : 'bg-sky-500 border-sky-400 text-white'
                  : hasCue
                  ? dark ? 'bg-emerald-900/40 border-emerald-700 text-emerald-400' : 'bg-emerald-100 border-emerald-300 text-emerald-700'
                  : dark ? 'border-slate-700 text-slate-500 hover:border-sky-700 hover:text-sky-400' : 'border-slate-200 text-slate-400 hover:border-sky-400 hover:text-sky-600'
              }`}
            >
              slide-{n}
            </button>
          );
        })}
      </div>

      {/* Thumbnail preview strip */}
      {pdfBlob && activeSlide !== null && (
        <div className={`flex items-center gap-3 px-1 py-1 rounded-xl border ${border} ${dark ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
          <div className={`w-[140px] h-[79px] rounded-lg overflow-hidden border ${border} shrink-0`}>
            {thumbLoading ? (
              <div className={`w-full h-full animate-pulse ${dark ? 'bg-slate-700' : 'bg-slate-200'}`} />
            ) : thumbnails && thumbnails[activeSlide - 1] ? (
              <img
                src={`data:image/jpeg;base64,${thumbnails[activeSlide - 1]}`}
                alt={`slide ${activeSlide}`}
                className="w-full h-full object-cover transition-all duration-150"
              />
            ) : (
              <div className={`w-full h-full flex items-center justify-center text-[10px] ${dark ? 'bg-slate-800 text-slate-600' : 'bg-slate-100 text-slate-400'}`}>
                無縮圖
              </div>
            )}
          </div>
          <div className="space-y-0.5">
            <p className={`text-[13px] font-bold ${dark ? 'text-sky-300' : 'text-sky-700'}`}>
              slide-{activeSlide}
            </p>
            <p className={`text-[11px] ${faint}`}>
              第 {activeSlide} 頁 / 共 {slideCount} 頁
            </p>
            {thumbLoading && (
              <p className={`text-[10px] ${faint}`}>載入縮圖中…</p>
            )}
          </div>
        </div>
      )}

      {activeSlide !== null && (
        <p className={`text-[11px] ${dark ? 'text-sky-400' : 'text-sky-600'}`}>
          點選下方字幕列，標記為 slide-{activeSlide} 的起始點。再次點選同一列可移除。
        </p>
      )}

      {/* SRT entry list */}
      <div className={`h-64 overflow-y-auto rounded-xl border ${border} ${bg}`}>
        {srtEntries.length === 0 ? (
          <p className={`text-[11px] p-4 ${faint}`}>尚無字幕資料</p>
        ) : (
          srtEntries.map(entry => {
            const assignedSlide = cueMap.get(entry.id);
            const isTarget = activeSlide !== null && assignedSlide === activeSlide;
            const isClickable = activeSlide !== null;

            return (
              <div
                key={entry.id}
                onClick={() => handleRowClick(entry)}
                className={`flex items-start gap-2 px-3 py-2 border-b last:border-b-0 ${border} transition-colors ${
                  isClickable ? 'cursor-pointer' : 'cursor-default'
                } ${
                  isTarget
                    ? dark ? 'bg-sky-900/30' : 'bg-sky-50'
                    : assignedSlide !== undefined
                    ? dark ? 'bg-emerald-900/20' : 'bg-emerald-50/60'
                    : isClickable
                    ? dark ? 'hover:bg-slate-800/60' : 'hover:bg-slate-100'
                    : ''
                }`}
              >
                <span className={`text-[10px] font-mono shrink-0 mt-0.5 ${faint}`}>
                  {formatSec(entry.start)}
                </span>
                <span className={`text-[11px] leading-relaxed flex-1 ${textCls}`}>
                  {entry.text}
                </span>
                {assignedSlide !== undefined && (
                  <span
                    onClick={e => { e.stopPropagation(); assignSlide(entry.id, null); }}
                    title="移除標記"
                    className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full cursor-pointer transition-colors ${
                      dark ? 'bg-emerald-800/60 text-emerald-300 hover:bg-red-800/50 hover:text-red-300' : 'bg-emerald-100 text-emerald-700 hover:bg-red-100 hover:text-red-600'
                    }`}
                  >
                    s{assignedSlide}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className={`text-[10px] ${faint}`}>
        已標記 {slideCues.length} 個換頁點 ／ 共 {slideCount} 張投影片
      </p>
    </div>
  );
}

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getMissingSlides(slideCues: SrtSlideCue[], slideCount: number): number[] {
  const present = new Set(slideCues.map(c => c.slideIndex));
  return Array.from({ length: slideCount }, (_, i) => i + 1).filter(n => !present.has(n));
}
