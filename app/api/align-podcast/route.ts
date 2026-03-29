import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { MODEL_TEXT } from '@/lib/constants';

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

    const prompt = `
我將提供一段 Podcast 的完整錄音檔，以及對應的逐字稿（內含「投影片 N」的分節標記）。
請化身精確的字幕時間軸導播，仔細聆聽這段音頻，並比對逐字稿的內容，分析出每一張投影片的對話內容在錄音檔中『開始說話的精確秒數 (vocalStartSec)』。

嚴格要求：
1. 你的輸出必須是標準的 JSON 陣列，不可包含 markdown 代碼區塊或其他文字說明。
2. 陣列內的每個物件務必包含 "slideIndex" (投影片編號) 以及 "vocalStartSec" (這張投影片的第一句話在音頻中開始發聲的精確秒數，數字，可帶小數)。
3. 若有片頭停頓，第一張投影片的 vocalStartSec 不一定為 0。講者間的停頓會真實反映在下一張 vocalStartSec 的距離上。

範例輸出格式（務必純 JSON）：
[
  { "slideIndex": 1, "vocalStartSec": 2.5 },
  { "slideIndex": 2, "vocalStartSec": 30.0 }
]
`.trim();

    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: [{
        parts: [
          { text: prompt },
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
