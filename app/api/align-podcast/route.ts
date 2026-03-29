import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { MODEL_TEXT } from '@/lib/constants';
import { ALIGN_PODCAST_PROMPT } from '@/lib/prompts';

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

    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: [{
        parts: [
          { text: ALIGN_PODCAST_PROMPT },
          { text: `\n\n=== 逐字稿 ===\n${script}\n================\n` },
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: audioBase64
            }
          }
        ]
      }],
      config: {
        responseMimeType: 'application/json',
      }
    });

    const rawJSON = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
    // 預防 AI 還是回傳了 Markdown block (如 ```json)
    const cleanedJSON = rawJSON.replace(/```json/g, '').replace(/```/g, '').trim();
    const timings = JSON.parse(cleanedJSON);

    return NextResponse.json({ timings });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Missing API Key') return unauthorizedResponse();
    console.error('Align Podcast Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
