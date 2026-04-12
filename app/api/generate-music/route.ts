import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { getMusicModel } from '@/lib/constants';
import { logUsage, getEmailFromRequest } from '@/lib/usageLogger';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    logUsage(getEmailFromRequest(req), 'generate-music');
    const ai = getAI(req);
    const { lyrics, duration, musicModel, contentLanguage } = await req.json();
    console.log(`[generate-music] contentLanguage=${contentLanguage ?? 'zh-TW'}`);

    const modelName = getMusicModel(duration ?? '90-second', musicModel);

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ parts: [{ text: lyrics }] }],
      config: { responseModalities: ['AUDIO', 'TEXT'] },
    });

    let audioBase64: string | null = null;
    let audioMimeType = 'audio/mpeg';
    let metadataText = '';

    // 🌟 關鍵安全解析邏輯：無序遍歷所有 parts
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.text) {
        metadataText += part.text + '\n';
      } else if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/')) {
        audioBase64 = part.inlineData.data ?? null;
        audioMimeType = part.inlineData.mimeType ?? 'audio/mpeg';
      }
    }
    void metadataText;

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
    if (err instanceof Error && (err.message === 'Missing API Key' || err.name === 'RequestAuthError')) {
      return unauthorizedResponse(err);
    }
    console.error('[generate-music] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
