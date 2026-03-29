import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { MODEL_TEXT } from '@/lib/constants';
import { GENERATE_MUSIC_SRT, FIND_TRANSITIONS_PROMPT } from '@/lib/prompts';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { lyrics, audioBase64 } = await req.json();

    if (!lyrics || !audioBase64) {
      return NextResponse.json({ error: 'Missing lyrics or audio data' }, { status: 400 });
    }

    // ----- Phase 1: AI generates sentence-by-sentence SRT -----
    const srtResponse = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: [{
        parts: [
          { text: GENERATE_MUSIC_SRT },
          { text: `\n\n=== 歌詞參考 ===\n${lyrics}\n================\n` },
          {
            inlineData: {
              mimeType: 'audio/mp3',
              data: audioBase64
            }
          }
        ]
      }]
    });

    const rawSrt = srtResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const srt = rawSrt.replace(/```srt/gi, '').replace(/```/g, '').trim();

    // ----- Phase 2: AI finds slide transitions from Text + SRT -----
    const timingResponse = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: [{
        parts: [
          { text: FIND_TRANSITIONS_PROMPT },
          { text: `\n\n=== [資料 A] 原始文稿 ===\n${lyrics}\n================\n` },
          { text: `\n=== [資料 B] 高精準 SRT 時間軸 ===\n${srt}\n================\n` }
        ]
      }],
      config: {
        responseMimeType: 'application/json',
      }
    });

    const rawJSON = timingResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
    const cleanedJSON = rawJSON.replace(/```json/gi, '').replace(/```/g, '').trim();
    const timings = JSON.parse(cleanedJSON);

    return NextResponse.json({ srt, timings });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Missing API Key') return unauthorizedResponse();
    console.error('Align Music Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
