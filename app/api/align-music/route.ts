import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { MODEL_TEXT } from '@/lib/constants';
import { ALIGN_MUSIC_PROMPT } from '@/lib/prompts';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { lyrics, audioBase64 } = await req.json();

    if (!lyrics || !audioBase64) {
      return NextResponse.json({ error: 'Missing lyrics or audio data' }, { status: 400 });
    }

    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: [{
        parts: [
          { text: ALIGN_MUSIC_PROMPT },
          { text: `\n\n=== 歌詞參考 ===\n${lyrics}\n================\n` },
          {
            inlineData: {
              mimeType: 'audio/mp3',
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
    console.error('Align Music Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
