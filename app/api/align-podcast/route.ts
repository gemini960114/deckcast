import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { MODEL_TEXT } from '@/lib/constants';
import { GENERATE_PODCAST_SRT, FIND_TRANSITIONS_PROMPT } from '@/lib/prompts';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    // Vercel / Cloud Run 預設 NextRequest 對於 body size 在 standalone runtime 相對寬鬆，
    // 但為避免超過預設 JSON parse 上限，通常建議從前端直傳 base64 字串配合前端限流。
    const { script, audioBase64 } = await req.json();

    if (!script || !audioBase64) {
      return NextResponse.json({ error: 'Missing script or audio data' }, { status: 400 });
    }

    // ----- Phase 1: AI generates sentence-by-sentence SRT -----
    const srtResponse = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: [{
        parts: [
          { text: GENERATE_PODCAST_SRT },
          { text: `\n\n=== 逐字稿 ===\n${script}\n================\n` },
          {
            inlineData: {
              mimeType: 'audio/wav',
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
          { text: `\n\n=== [資料 A] 原始文稿 ===\n${script}\n================\n` },
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
    console.error('Align Podcast Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
