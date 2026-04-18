import { NextRequest, NextResponse } from 'next/server';
import { getGeminiAI, unauthorizedResponse } from '@/lib/getAI';
import { DEFAULT_STEP41_MODEL, isGeminiModel, resolveStep41Model, resolveTextModel } from '@/lib/constants';
import { logUsage, getEmailFromRequest } from '@/lib/usageLogger';
import { FIND_PODCAST_TRANSITIONS_PROMPT, GENERATE_PODCAST_SRT, REFINE_PODCAST_SRT_TEXT_PROMPT } from '@/lib/prompts';
import { isWhisperConfigured, mapContentLanguageToWhisperLanguage, transcribeAudioWithWhisper } from '@/lib/whisper';
import type { ContentLanguage } from '@/lib/types';
import { parseMusicSrtJson, repairSrtEntries, srtEntriesToText } from '@/lib/srt';
import { buildPodcastFallbackTimingsByScriptWeight, buildSlideCuesFromTransitionMatches, buildSlideTimingsFromSrtIds, normalizeTimings } from '@/lib/timing';
import type { AlignPodcastDiagnostics, MusicTransitionMatch, SrtEntry, SrtSlideCue } from '@/lib/types';
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
    console.warn('Failed to parse corrected podcast SRT text JSON:', e);
    return srtEntries;
  }
}

function extractSlideCount(script: string): number {
  const matches = [...script.matchAll(/投影片\s*(\d+)\s*[:：]/gi)];
  if (matches.length === 0) return 0;
  return Math.max(...matches.map(match => Number(match[1]) || 0));
}

function parsePodcastTransitionMatchesJSON(raw: string, slideCount: number, srtEntries: SrtEntry[]): MusicTransitionMatch[] {
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
    console.warn('Failed to parse podcast transition matches JSON:', e);
    return [];
  }
}

function buildFallbackPodcastSrt(script: string): string {
  const lines = script
    .split('\n')
    .map(line => line.trim())
    .filter(line => line)
    .filter(line => !/^風格[:：]/.test(line))
    .filter(line => !/^投影片\s*\d+[:：]/.test(line))
    .filter(line => !/^(speaker\s*\d+|mary老師|阿哲|男聲|女聲)\s*[:：]/i.test(line));

  return lines
    .map((line, index) => `${index + 1}\n00:00:${String(index * 3).padStart(2, '0')},000 --> 00:00:${String(index * 3 + 2).padStart(2, '0')},500\n${line}`)
    .join('\n\n')
    .trim();
}

async function generatePodcastSrtWithGemini(params: {
  ai: ReturnType<typeof getGeminiAI>;
  audioBase64: string;
  audioMimeType: string;
  script: string;
  textModel: string;
}): Promise<SrtEntry[]> {
  const response = await params.ai.models.generateContent({
    model: params.textModel,
    contents: [{
      parts: [
        { text: GENERATE_PODCAST_SRT },
        {
          inlineData: {
            data: params.audioBase64,
            mimeType: params.audioMimeType,
          },
        },
        { text: `\n\n=== [資料 B] Podcast 參考逐字稿 ===\n${params.script}\n========================\n` },
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
    logUsage(getEmailFromRequest(req), 'align-podcast');
    // Vercel / Cloud Run 預設 NextRequest 對於 body size 在 standalone runtime 相對寬鬆，
    // 但為避免超過預設 JSON parse 上限，通常建議從前端直傳 base64 字串配合前端限流。
    const { script, audioBase64, audioMimeType, textModel, step41Model, step42Model, contentLanguage } = await req.json();
    const whisperLanguage = mapContentLanguageToWhisperLanguage(contentLanguage as ContentLanguage | undefined);

    if (!script || !audioBase64) {
      return NextResponse.json({ error: 'Missing script or audio data' }, { status: 400 });
    }

    const slideCount = extractSlideCount(script);
    const requestedPhase2Model = resolveTextModel(step42Model ?? textModel);
    const requestedPhase1Model = resolveStep41Model(step41Model);
    const phase1ModelName = isGeminiModel(requestedPhase1Model) ? requestedPhase1Model : DEFAULT_STEP41_MODEL;
    const phase2ModelName = requestedPhase2Model;
    const safeAudioMimeType = typeof audioMimeType === 'string' ? audioMimeType : 'audio/mpeg';
    const diagnostics: AlignPodcastDiagnostics = {
      phase1Success: false,
      asrMode: isWhisperConfigured() ? 'whisper+gemini' : 'gemini-only',
      srtSource: 'none',
      timingSource: 'equal-fallback',
      issues: [],
    };

    // ----- Phase 1: Whisper generates sentence-by-sentence SRT -----
    let srt = '';
    let srtEntries: SrtEntry[] = [];
    let totalDuration = 0;
    if (isWhisperConfigured()) {
      try {
        const transcription = await transcribeAudioWithWhisper({
          audioBase64,
          mimeType: safeAudioMimeType,
          language: whisperLanguage,
        });

        srtEntries = transcription.srtEntries;
        totalDuration = typeof transcription.duration === 'number' && transcription.duration > 0
          ? transcription.duration
          : (srtEntries[srtEntries.length - 1]?.end ?? 0);

        if (srtEntries.length) {
          diagnostics.phase1Success = true;
          diagnostics.srtSource = 'whisper';
          try {
            const ai = getGeminiAI(req);
            const textRefineResponse = await ai.models.generateContent({
              model: phase1ModelName,
              contents: [{
                parts: [
                  { text: REFINE_PODCAST_SRT_TEXT_PROMPT },
                  {
                    inlineData: {
                      data: audioBase64,
                      mimeType: safeAudioMimeType,
                    },
                  },
                  { text: `\n\n=== [資料 B] Whisper 逐段轉錄 ===\n${JSON.stringify(srtEntries, null, 2)}\n========================\n` },
                  { text: `\n=== [資料 C] Podcast 參考逐字稿 ===\n${script}\n========================\n` },
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
            console.warn('Podcast text refinement failed, keeping raw Whisper text:', textRefineErr);
          }
        } else {
          diagnostics.issues.push('Whisper returned empty segments.');
        }

        srt = srtEntriesToText(srtEntries);
      } catch (phase1Err) {
        diagnostics.issues.push(`Whisper phase failed: ${String(phase1Err)}`);
        console.warn('Whisper podcast transcription failed, will try Gemini-only mode:', phase1Err);
      }
    }

    if (!srtEntries.length) {
      try {
        srtEntries = await generatePodcastSrtWithGemini({
          ai: getGeminiAI(req),
          audioBase64,
          audioMimeType: safeAudioMimeType,
          script,
          textModel: phase1ModelName,
        });
        totalDuration = srtEntries[srtEntries.length - 1]?.end ?? totalDuration;
        srt = srtEntriesToText(srtEntries);
        if (srtEntries.length) {
          diagnostics.phase1Success = true;
          diagnostics.asrMode = 'gemini-only';
          diagnostics.srtSource = 'gemini-only';
        }
      } catch (geminiPhaseErr) {
        diagnostics.issues.push(`Gemini-only phase failed: ${String(geminiPhaseErr)}`);
        console.warn('Gemini-only podcast transcription failed, using fallback:', geminiPhaseErr);
      }
    }

    if (!srt) {
      srt = buildFallbackPodcastSrt(script);
      diagnostics.srtSource = srt ? 'script-fallback' : 'none';
      totalDuration = totalDuration || (srtEntries[srtEntries.length - 1]?.end ?? 0);
      if (!srt) {
        diagnostics.issues.push('Script fallback SRT is empty.');
      }
    }

    // ----- Phase 2: AI finds slide transitions from Text + SRT entries -----
    let matches: MusicTransitionMatch[] = [];
    if (slideCount > 0 && srtEntries.length) {
      try {
        const rawJSON = await generateText(req, {
          model: phase2ModelName,
          expectJson: true,
          prompt:
            `${FIND_PODCAST_TRANSITIONS_PROMPT}\n\n` +
            `=== [資料 A] 原始文稿 ===\n${script}\n================\n\n` +
            `=== [資料 B] 字幕 JSON 陣列 ===\n${JSON.stringify(srtEntries, null, 2)}\n================\n`,
        });
        matches = parsePodcastTransitionMatchesJSON(rawJSON, slideCount, srtEntries);
      } catch (phase2Err) {
        diagnostics.issues.push(`Phase 2 failed: ${String(phase2Err)}`);
        console.warn('Podcast Phase 2 transition matching failed:', phase2Err);
      }
    }

    let timings = slideCount > 0 && totalDuration > 0
      ? buildSlideTimingsFromSrtIds(matches, srtEntries, slideCount, totalDuration)
      : [];

    if (matches.length > 0 && timings.length > 0 && totalDuration > 0) {
      diagnostics.timingSource = 'srt-id';
      timings = normalizeTimings(timings, slideCount, totalDuration);
    } else if (slideCount > 0 && totalDuration > 0) {
      diagnostics.timingSource = 'script-char-fallback';
      diagnostics.issues.push('Phase 2 returned insufficient matches, using script-char fallback.');
      timings = buildPodcastFallbackTimingsByScriptWeight(script, slideCount, totalDuration);
    }

    if (!timings.length && slideCount > 0 && totalDuration > 0) {
      diagnostics.timingSource = 'equal-fallback';
      diagnostics.issues.push('All timing strategies failed, using equal fallback.');
      timings = normalizeTimings([], slideCount, totalDuration);
    }

    const slideCues: SrtSlideCue[] = buildSlideCuesFromTransitionMatches(matches);

    return NextResponse.json({ srt, srtEntries, slideCues, timings, diagnostics });
  } catch (err: unknown) {
    if (err instanceof Error && (err.message === 'Missing API Key' || err.name === 'RequestAuthError')) {
      return unauthorizedResponse(err);
    }
    console.error('Align Podcast Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
