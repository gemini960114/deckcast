'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SrtEntry } from '@/lib/types';

interface AutoResizeTextareaProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const AutoResizeTextarea = React.memo(function AutoResizeTextarea({
  value,
  onChange,
  className,
}: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className={className}
    />
  );
});

interface SrtReviewPanelProps {
  audioBlob: Blob | null;
  srtEntries: SrtEntry[];
  srtConfirmed: boolean;
  onConfirm: () => void;
  onRealign: () => void;
  realigning?: boolean;
  dark?: boolean;
  onEntryTextChange?: (id: number, text: string) => void;
  onEntryBlur?: () => void;
}

export default function SrtReviewPanel({
  audioBlob,
  srtEntries,
  srtConfirmed,
  onConfirm,
  onRealign,
  realigning = false,
  dark = false,
  onEntryTextChange,
  onEntryBlur,
}: SrtReviewPanelProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const pendingSeekRef = useRef<number | null>(null);
  const shouldAutoplayAfterSeekRef = useRef(false);

  useEffect(() => {
    if (!audioBlob) return;
    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioBlob]);

  const activeIndex = srtEntries.findLastIndex(e => currentTime >= e.start && currentTime < e.end);
  rowRefs.current = rowRefs.current.slice(0, srtEntries.length);

  useEffect(() => {
    const el = rowRefs.current[activeIndex];
    if (el && listRef.current) {
      el.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    }
  }, [activeIndex]);

  function seekTo(start: number) {
    const audio = audioRef.current;
    if (!audio) return;

    pendingSeekRef.current = start;
    shouldAutoplayAfterSeekRef.current = !audio.paused; // 保留原本播放狀態

    setCurrentTime(start);     // 先更新 UI，讓字幕高亮不卡住
    audio.currentTime = start; // 發出 seek，不立刻 play
  }

  function handleSeeking(e: React.SyntheticEvent<HTMLAudioElement>) {
    setCurrentTime(e.currentTarget.currentTime);
  }

  function handleSeeked(e: React.SyntheticEvent<HTMLAudioElement>) {
    const audio = e.currentTarget;
    setCurrentTime(audio.currentTime);

    if (shouldAutoplayAfterSeekRef.current) {
      shouldAutoplayAfterSeekRef.current = false;
      pendingSeekRef.current = null;
      void audio.play().catch(() => {});
    } else {
      pendingSeekRef.current = null;
    }
  }

  function handleCanPlay(e: React.SyntheticEvent<HTMLAudioElement>) {
    const audio = e.currentTarget;

    if (pendingSeekRef.current !== null && shouldAutoplayAfterSeekRef.current) {
      shouldAutoplayAfterSeekRef.current = false;
      pendingSeekRef.current = null;
      void audio.play().catch(() => {});
    }
  }

  const handleEntryChange = useCallback((id: number, text: string) => {
    onEntryTextChange?.(id, text);
  }, [onEntryTextChange]);

  const faint = dark ? 'text-slate-500' : 'text-slate-400';
  const border = dark ? 'border-slate-700' : 'border-slate-200';
  const bg = dark ? 'bg-slate-900' : 'bg-slate-50';

  return (
    <div className={`rounded-2xl border ${border} p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <p className={`text-xs font-bold uppercase tracking-widest ${dark ? 'text-amber-400' : 'text-amber-600'}`}>
          SRT 字幕確認
        </p>
        {srtConfirmed && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${dark ? 'bg-emerald-900/40 text-emerald-400' : 'bg-emerald-100 text-emerald-700'}`}>
            ✓ 已確認
          </span>
        )}
      </div>

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          controls
          onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
          onSeeking={handleSeeking}
          onSeeked={handleSeeked}
          onCanPlay={handleCanPlay}
          className="w-full h-9 rounded-xl"
          style={{ colorScheme: dark ? 'dark' : 'light' }}
        />
      )}

      <p className={`text-[10px] leading-relaxed ${faint}`}>
        <span className="mr-1">✎</span>
        字幕文字可直接點擊修改（時間軸不可調整）。編輯完成後點擊面板外會自動儲存，並清除舊的簡報／影片快取以便重新生成。
      </p>

      <div
        ref={listRef}
        className={`h-52 overflow-y-auto rounded-xl border ${border} ${bg}`}
        onBlur={(e) => {
          if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) {
            onEntryBlur?.();
          }
        }}
      >
        {srtEntries.length === 0 ? (
          <p className={`text-[11px] p-4 ${faint}`}>尚無字幕資料</p>
        ) : (
          srtEntries.map((entry, i) => {
            const isActive = i === activeIndex;
            return (
              <div
                key={entry.id}
                ref={el => { rowRefs.current[i] = el; }}
                onClick={() => seekTo(entry.start)}
                className={`flex gap-2 px-3 py-2 cursor-pointer transition-colors border-b last:border-b-0 ${border} ${
                  isActive
                    ? dark ? 'bg-amber-900/30' : 'bg-amber-50'
                    : dark ? 'hover:bg-slate-800/60' : 'hover:bg-slate-100'
                }`}
              >
                <span className={`text-[10px] font-mono shrink-0 mt-0.5 ${faint}`}>
                  {formatSec(entry.start)}
                </span>
                <AutoResizeTextarea
                  value={entry.text}
                  onChange={(text) => handleEntryChange(entry.id, text)}
                  className={`flex-1 w-full bg-transparent outline-none border-b border-transparent focus:border-amber-500/50 transition-all resize-none overflow-hidden leading-relaxed text-[11px] ${
                    isActive
                      ? dark ? 'text-amber-300 font-semibold' : 'text-amber-700 font-semibold'
                      : dark ? 'text-slate-200' : 'text-slate-800'
                  }`}
                />
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {!srtConfirmed && (
          <button
            onClick={onConfirm}
            disabled={srtEntries.length === 0}
            className={`flex-1 text-[12px] font-bold py-2 px-4 rounded-xl transition-all ${
              srtEntries.length === 0
                ? 'opacity-40 cursor-not-allowed bg-slate-300 text-slate-500'
                : dark
                ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            SRT 時間正確，進行簡報對齊
          </button>
        )}
        <button
          onClick={onRealign}
          disabled={realigning}
          className={`text-[11px] font-semibold px-3 py-2 rounded-xl border transition-all ${
            realigning
              ? 'opacity-50 cursor-not-allowed'
              : dark
              ? 'border-slate-600 text-slate-400 hover:border-amber-600 hover:text-amber-400'
              : 'border-slate-300 text-slate-500 hover:border-amber-400 hover:text-amber-600'
          }`}
        >
          {realigning ? '重新對齊中...' : '重新生成 SRT 對齊'}
        </button>
      </div>
    </div>
  );
}

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
