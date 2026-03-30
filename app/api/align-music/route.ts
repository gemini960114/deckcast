import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { MODEL_TEXT } from '@/lib/constants';
import { GENERATE_MUSIC_SRT, FIND_TRANSITIONS_PROMPT } from '@/lib/prompts';

export const maxDuration = 300;

// ── SRT 清洗：移除 markdown 包裝、前後空白行 ──
function cleanSrt(raw: string): string {
  return raw
    .replace(/```srt/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*\n+/, '')
    .replace(/\n+\s*$/, '')
    .trim();
}

// ── JSON 解析：防呆，確保一定回傳陣列 ──
function parseTimingsJSON(raw: string): Array<{ slideIndex: number; vocalStartSec: number }> {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    console.warn('Timings JSON is not an array, got:', typeof parsed);
    return [];
  } catch (e) {
    console.warn('Failed to parse timings JSON:', e, '\nRaw:', cleaned.slice(0, 200));
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { lyrics, audioBase64 } = await req.json();

    if (!lyrics || !audioBase64) {
      return NextResponse.json({ error: 'Missing lyrics or audio data' }, { status: 400 });
    }

    // ── Phase 1: AI 以 lyrics 為文字錨點，只用 audio 定位時間，產出精準 SRT ──
    let srt = '';
    try {
      const srtResponse = await ai.models.generateContent({
        model: MODEL_TEXT,
        contents: [{
          parts: [
            { text: GENERATE_MUSIC_SRT },
            { text: `\n\n=== [資料 A] 歌詞文本（正確文字唯一來源）===\n${lyrics}\n========================\n` },
            {
              inlineData: {
                mimeType: 'audio/mp3',
                data: audioBase64,
              },
            },
          ],
        }],
      });

      const rawSrt = srtResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      srt = cleanSrt(rawSrt);

      if (!srt) {
        console.warn('Phase 1: SRT response was empty after cleaning.');
      }
    } catch (phase1Err) {
      console.warn('Phase 1 SRT generation failed, will attempt Phase 2 with lyrics only:', phase1Err);
    }

    // ── Phase 2: AI 以文字定錨法找出每張投影片的換頁秒數 ──
    const phase2DataB = srt
      ? `=== [資料 B] 精準 SRT 時間軸（由音訊比對 lyrics 所產生）===\n${srt}\n========================`
      : `=== [資料 B] SRT 時間軸 ===\n（Phase 1 生成失敗，無法提供 SRT。請參考資料 A 歌詞中的時間標記（格式如 [0:00 - 0:10]）進行估算，並盡量合理推測各投影片的 vocalStartSec）\n========================`;

    const timingResponse = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: [{
        parts: [
          { text: FIND_TRANSITIONS_PROMPT },
          { text: `\n\n=== [資料 A] 原始歌詞（含投影片標記）===\n${lyrics}\n========================\n\n${phase2DataB}` },
        ],
      }],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const rawJSON = timingResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
    const timings = parseTimingsJSON(rawJSON);

    return NextResponse.json({ srt, timings });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Missing API Key') return unauthorizedResponse();
    console.error('Align Music Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
