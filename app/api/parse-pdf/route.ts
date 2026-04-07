import { NextRequest, NextResponse } from 'next/server';
import { getGeminiAI, unauthorizedResponse } from '@/lib/getAI';
import { stripMarkdown } from '@/lib/stripMarkdown';
import { DEFAULT_MULTIMODAL_MODEL, resolveStep41Model } from '@/lib/constants';
import { PARSE_PDF_PROMPT } from '@/lib/prompts';

export async function POST(req: NextRequest) {
  try {
    const ai = getGeminiAI(req);
    const { pdf, multimodalModel, textModel } = await req.json() as { pdf: string; multimodalModel?: string; textModel?: string };
    const modelName = resolveStep41Model(multimodalModel ?? textModel ?? DEFAULT_MULTIMODAL_MODEL);

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{
        parts: [
          { text: PARSE_PDF_PROMPT },
          { inlineData: { mimeType: 'application/pdf', data: pdf } },
        ],
      }],
    });

    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const slides = stripMarkdown(raw);
    return NextResponse.json({ slides });
  } catch (err: unknown) {
    if (err instanceof Error && (err.message === 'Missing API Key' || err.name === 'RequestAuthError')) {
      return unauthorizedResponse(err);
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
