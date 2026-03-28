import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { MODEL_MUSIC } from '@/lib/constants';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { lyrics } = await req.json();

    const response = await ai.models.generateContent({
      model: MODEL_MUSIC,
      contents: [{ parts: [{ text: lyrics }] }],
      config: { responseModalities: ['AUDIO', 'TEXT'] },
    });

    console.log('[generate-music] parts:', response.candidates?.[0]?.content?.parts?.map(p =>
      p.inlineData ? `inlineData(${p.inlineData.mimeType})` : 'text'
    ));

    let audioBase64: string | null = null;
    let audioMimeType = 'audio/mpeg';
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        audioBase64 = part.inlineData.data;
        audioMimeType = part.inlineData.mimeType ?? 'audio/mpeg';
        break;
      }
    }

    if (!audioBase64) {
      const feedback = (response as unknown as Record<string, unknown>).promptFeedback as Record<string, unknown> | undefined;
      const blockReason = feedback?.blockReason;
      console.error('[generate-music] blocked:', blockReason);
      return NextResponse.json(
        {
          error: blockReason === 'PROHIBITED_CONTENT'
            ? 'PROHIBITED_CONTENT'
            : 'Music generation returned no audio data',
        },
        { status: 502 }
      );
    }

    const audioData = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
    return new NextResponse(audioData, {
      headers: { 'Content-Type': audioMimeType },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Missing API Key') {
      return unauthorizedResponse();
    }
    console.error('[generate-music] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
