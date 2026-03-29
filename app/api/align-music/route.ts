import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { MODEL_TEXT } from '@/lib/constants';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { lyrics, audioBase64 } = await req.json();

    if (!lyrics || !audioBase64) {
      return NextResponse.json({ error: 'Missing lyrics or audio data' }, { status: 400 });
    }

    const prompt = `
我將提供一首 AI 生成的歌曲音檔，以及其對應的歌詞本（內含「投影片 N」的標記）。
請化身為專業的 MV 導播，仔細聆聽整首歌的段落結構（前奏、主歌、副歌、間奏等）。
請精準抓出「每一張投影片的歌詞」在音樂中『開始演唱的精確秒數 (vocalStartSec)』。

嚴格要求：
1. 你的輸出必須是標準的 JSON 陣列，不可包含 markdown 等其他說明。
2. 每個物件必須包含 "slideIndex" (編號) 以及 "vocalStartSec" (這張投影片對應的第一句歌詞，在音樂中第一次發聲的精確秒數，允許帶小數點)。
3. 音樂通常有「前奏」，所以第一張投影片的 vocalStartSec 絕對大於 0（如 15.5）。
4. 本次對齊法捨棄相對時長，改用「新投影片開始播放的絕對時間點」。請專注聽歌詞發生的當下秒數。

範例輸出格式（務必純 JSON）：
[
  { "slideIndex": 1, "vocalStartSec": 15.5 },
  { "slideIndex": 2, "vocalStartSec": 45.0 }
]
`.trim();

    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: [{
        parts: [
          { text: prompt },
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
