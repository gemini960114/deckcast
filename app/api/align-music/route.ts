import { NextRequest, NextResponse } from 'next/server';
import { getGeminiAI, unauthorizedResponse } from '@/lib/getAI';
import { DEFAULT_STEP71_MODEL, isGeminiModel, resolveStep71Model, resolveTextModel } from '@/lib/constants';
import { FIND_TRANSITIONS_PROMPT, GENERATE_MUSIC_SRT, REFINE_MUSIC_SRT_TEXT_PROMPT } from '@/lib/prompts';
import {
  buildFallbackSrtEntriesFromLyrics,
  parseMusicSrtJson,
  repairSrtEntries,
  srtEntriesToText,
} from '@/lib/srt';
import {
  buildMusicFallbackTimingsByLyricsWeight,
  buildSlideTimingsFromSrtIds,
  normalizeTimings,
} from '@/lib/timing';
import type { AlignMusicDiagnostics, MusicTransitionMatch, SrtEntry } from '@/lib/types';
import { isWhisperConfigured, mapContentLanguageToWhisperLanguage, transcribeAudioWithWhisper } from '@/lib/whisper';
import type { ContentLanguage } from '@/lib/types';
import { generateText } from '@/lib/llm';

export const maxDuration = 300;

function parseNumericValue(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function stripMetaLine(line: string): boolean {
  return !line ||
    line.startsWith('歌曲名稱：') ||
    line.startsWith('風格：') ||
    line.startsWith('總時長：') ||
    line.startsWith('節奏：') ||
    line.startsWith('關鍵元素：') ||
    line === '---';
}

function removeInlineTimingAndTags(line: string, keepSlideTag: boolean): string {
  let cleaned = line;
  if (keepSlideTag) {
    // Preserve [Slide X], but remove all other [XYZ] like [Verse 1], [0:00 - 0:10]
    cleaned = cleaned.replace(/\[(?!\s*Slide\s*\d+\s*)[^\]]*\]/gi, '');
  } else {
    // Remove all brackets
    cleaned = cleaned.replace(/\[[^\]]*\]/g, '');
  }
  return cleaned.replace(/\s{2,}/g, ' ').trim();
}

function buildStructuredLyrics(rawLyrics: string): string {
  return rawLyrics
    .split('\n')
    .map(line => line.trim())
    .filter(line => !stripMetaLine(line))
    .map(line => removeInlineTimingAndTags(line, true))
    .filter(Boolean)
    .join('\n');
}

function parseTransitionMatchesJSON(raw: string, slideCount: number, srtEntries: SrtEntry[]): MusicTransitionMatch[] {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    const validIds = new Set(srtEntries.map(entry => entry.id));
    return parsed
      .map((item): MusicTransitionMatch | null => {
        const slideIndex = parseNumericValue(item?.slideIndex);
        if (!Number.isFinite(slideIndex) || slideIndex < 1 || slideIndex > slideCount) return null;
        const rawId = parseNumericValue(item?.startSrtId);
        const startSrtId = Number.isFinite(rawId) && validIds.has(Math.trunc(rawId)) ? Math.trunc(rawId) : null;
        const confidence = parseNumericValue(item?.confidence);
        return {
          slideIndex: Math.trunc(slideIndex),
          startSrtId,
          confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : undefined,
          matchReason: typeof item?.matchReason === 'string' ? item.matchReason.trim() : undefined,
        };
      })
      .filter((item): item is MusicTransitionMatch => item !== null)
      .sort((a, b) => a.slideIndex - b.slideIndex);
  } catch (e) {
    console.warn('Failed to parse transition matches JSON:', e);
    return [];
  }
}

function parseCorrectedSrtTexts(raw: string, srtEntries: SrtEntry[]): SrtEntry[] {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return srtEntries;

    const correctedTextById = new Map<number, string>();
    for (const item of parsed) {
      const id = parseNumericValue(item?.id);
      if (!Number.isFinite(id)) continue;
      const text = typeof item?.text === 'string' ? item.text.trim() : '';
      if (!text) continue;
      correctedTextById.set(Math.trunc(id), text);
    }

    return srtEntries.map(entry => ({
      ...entry,
      text: correctedTextById.get(entry.id) ?? entry.text,
    }));
  } catch (e) {
    console.warn('Failed to parse corrected SRT text JSON:', e);
    return srtEntries;
  }
}

function extractSlideCount(lyrics: string): number {
  const matches = [...lyrics.matchAll(/\[Slide\s*(\d+)\]/gi)];
  if (matches.length === 0) return 0;
  return Math.max(...matches.map(match => Number(match[1]) || 0));
}

function buildSlideAnchorSummary(lyrics: string, slideCount: number): string {
  const linesBySlide = new Map<number, string[]>();
  for (let index = 1; index <= slideCount; index++) {
    linesBySlide.set(index, []);
  }

  let currentSlideIndex: number | null = null;
  for (const rawLine of lyrics.split('\n')) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) continue;

    const slideMatch = trimmedLine.match(/\[Slide\s*(\d+)\]/i);
    if (slideMatch) {
      const parsedIndex = Number(slideMatch[1]);
      currentSlideIndex = Number.isFinite(parsedIndex) && parsedIndex >= 1 && parsedIndex <= slideCount
        ? parsedIndex
        : null;
      continue;
    }

    if (currentSlideIndex === null) continue;

    const cleanedLine = removeInlineTimingAndTags(trimmedLine, false);
    if (!cleanedLine) continue;
    linesBySlide.get(currentSlideIndex)?.push(cleanedLine);
  }

  let previousLastLine: string | null = null;
  const sections = Array.from({ length: slideCount }, (_, index) => {
    const contentLines = linesBySlide.get(index + 1) ?? [];
    const section = {
      slideIndex: index + 1,
      previousLastLine,
      currentFirstLine: contentLines[0] ?? null,
      currentSecondLine: contentLines[1] ?? null,
      currentLastLine: contentLines.length > 0 ? contentLines[contentLines.length - 1] : null,
    };
    previousLastLine = section.currentLastLine;
    return section;
  });

  return JSON.stringify(sections, null, 2);
}

async function generateMusicSrtWithGemini(params: {
  ai: ReturnType<typeof getGeminiAI>;
  audioBase64: string;
  audioMimeType: string;
  structuredLyrics: string;
  textModel: string;
}): Promise<SrtEntry[]> {
  const response = await params.ai.models.generateContent({
    model: params.textModel,
    contents: [{
      parts: [
        { text: GENERATE_MUSIC_SRT },
        {
          inlineData: {
            data: params.audioBase64,
            mimeType: params.audioMimeType,
          },
        },
        { text: `\n\n=== [資料 A] 參考歌詞文本 ===\n${params.structuredLyrics}\n========================\n` },
      ],
    }],
    config: {
      responseMimeType: 'application/json',
    },
  });

  const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  return repairSrtEntries(parseMusicSrtJson(raw));
}

export async function POST(req: NextRequest) {
  try {
    const {
      lyrics,
      audioBase64,
      audioMimeType,
      duration,
      slideCount: rawSlideCount,
      textModel,
      step71Model,
      step72Model,
      contentLanguage,
    } = await req.json();
    const whisperLanguage = mapContentLanguageToWhisperLanguage(contentLanguage as ContentLanguage | undefined);

    if (!lyrics || !audioBase64) {
      return NextResponse.json({ error: 'Missing lyrics or audio data' }, { status: 400 });
    }

    const totalDuration = typeof duration === 'number' && duration > 0 ? duration : 0;
    const requestedPhase2Model = resolveTextModel(step72Model ?? textModel);
    const requestedPhase1Model = resolveStep71Model(step71Model);
    const phase1ModelName = isGeminiModel(requestedPhase1Model) ? requestedPhase1Model : DEFAULT_STEP71_MODEL;
    const phase2ModelName = requestedPhase2Model;
    const structuredLyrics = buildStructuredLyrics(lyrics);
    const slideCount = typeof rawSlideCount === 'number' && rawSlideCount > 0 ? rawSlideCount : extractSlideCount(structuredLyrics);
    const diagnostics: AlignMusicDiagnostics = {
      phase1Success: false,
      asrMode: isWhisperConfigured() ? 'whisper+gemini' : 'gemini-only',
      srtSource: 'none',
      timingSource: 'equal-fallback',
      issues: [],
    };

    let srtEntries: SrtEntry[] = [];
    const safeAudioMimeType = typeof audioMimeType === 'string' ? audioMimeType : 'audio/mpeg';
    if (isWhisperConfigured()) {
      try {
        const transcription = await transcribeAudioWithWhisper({
          audioBase64,
          mimeType: safeAudioMimeType,
          language: whisperLanguage,
        });

        if (transcription.srtEntries.length) {
          srtEntries = transcription.srtEntries;
          diagnostics.phase1Success = true;
          diagnostics.srtSource = 'whisper';

          try {
            const ai = getGeminiAI(req);
            const textRefineResponse = await ai.models.generateContent({
              model: phase1ModelName,
              contents: [{
                parts: [
                  { text: REFINE_MUSIC_SRT_TEXT_PROMPT },
                  {
                    inlineData: {
                      data: audioBase64,
                      mimeType: safeAudioMimeType,
                    },
                  },
                  { text: `\n\n=== [資料 B] Whisper 逐段轉錄 ===\n${JSON.stringify(srtEntries, null, 2)}\n========================\n` },
                  { text: `\n=== [資料 C] 參考歌詞文本 ===\n${structuredLyrics}\n========================\n` },
                ],
              }],
              config: {
                responseMimeType: 'application/json',
              },
            });

            const rawCorrected = textRefineResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
            srtEntries = parseCorrectedSrtTexts(rawCorrected, srtEntries);
            diagnostics.srtSource = 'hybrid-whisper-gemini';
          } catch (textRefineErr) {
            diagnostics.issues.push(`Whisper text refinement failed: ${String(textRefineErr)}`);
            console.warn('Whisper text refinement failed, keeping raw Whisper text:', textRefineErr);
          }
        } else {
          diagnostics.issues.push('Whisper returned empty segments.');
        }
      } catch (phase1Err) {
        diagnostics.issues.push(`Whisper phase failed: ${String(phase1Err)}`);
        console.warn('Whisper phase failed, will try Gemini-only SRT generation:', phase1Err);
      }
    }

    if (!srtEntries.length) {
      try {
        srtEntries = await generateMusicSrtWithGemini({
          ai: getGeminiAI(req),
          audioBase64,
          audioMimeType: safeAudioMimeType,
          structuredLyrics,
          textModel: phase1ModelName,
        });
        if (srtEntries.length) {
          diagnostics.phase1Success = true;
          diagnostics.asrMode = 'gemini-only';
          diagnostics.srtSource = 'gemini-only';
        }
      } catch (geminiPhaseErr) {
        diagnostics.issues.push(`Gemini-only phase failed: ${String(geminiPhaseErr)}`);
        console.warn('Gemini-only SRT generation failed, will use fallback:', geminiPhaseErr);
      }
    }

    if (!srtEntries.length) {
      srtEntries = buildFallbackSrtEntriesFromLyrics(lyrics);
      diagnostics.srtSource = srtEntries.length ? 'lyrics-fallback' : 'none';
      if (!srtEntries.length) {
        diagnostics.issues.push('Lyrics fallback SRT entries are empty.');
      }
    }

    const srt = srtEntriesToText(srtEntries);

    let matches: MusicTransitionMatch[] = [];
    if (slideCount > 0 && srtEntries.length) {
      try {
        const rawMatches = await generateText(req, {
          model: phase2ModelName,
          expectJson: true,
          prompt:
            `${FIND_TRANSITIONS_PROMPT}\n\n` +
            `=== [資料 A] 投影片錨點摘要 JSON ===\n${buildSlideAnchorSummary(structuredLyrics, slideCount)}\n========================\n\n` +
            `=== [資料 B] 字幕 JSON 陣列 ===\n${JSON.stringify(srtEntries, null, 2)}\n========================`,
        });
        matches = parseTransitionMatchesJSON(rawMatches, slideCount, srtEntries);
      } catch (phase2Err) {
        diagnostics.issues.push(`Phase 2 failed: ${String(phase2Err)}`);
        console.warn('Phase 2 transition matching failed:', phase2Err);
      }
    }

    let timings = slideCount > 0 && totalDuration > 0
      ? buildSlideTimingsFromSrtIds(matches, srtEntries, slideCount, totalDuration)
      : [];

    if (matches.length > 0 && timings.length > 0 && totalDuration > 0) {
      diagnostics.timingSource = 'srt-id';
      timings = normalizeTimings(timings, slideCount, totalDuration);
    } else if (slideCount > 0 && totalDuration > 0) {
      diagnostics.timingSource = 'lyrics-weight-fallback';
      diagnostics.issues.push('Phase 2 returned insufficient matches, using lyrics-weight fallback.');
      timings = buildMusicFallbackTimingsByLyricsWeight(structuredLyrics, slideCount, totalDuration);
    }

    if (!timings.length && slideCount > 0 && totalDuration > 0) {
      diagnostics.timingSource = 'equal-fallback';
      diagnostics.issues.push('All timing strategies failed, using equal fallback.');
      timings = normalizeTimings([], slideCount, totalDuration);
    }

    return NextResponse.json({ srt, srtEntries, matches, timings, diagnostics });
  } catch (err: unknown) {
    if (err instanceof Error && (err.message === 'Missing API Key' || err.name === 'RequestAuthError')) {
      return unauthorizedResponse(err);
    }
    console.error('Align Music Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
