import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { stripMarkdown } from '@/lib/stripMarkdown';
import { MODEL_TEXT, PARSE_PDF_PROMPT } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { pdf } = await req.json() as { pdf: string };

    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
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
    if (err instanceof Error && err.message === 'Missing API Key') {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
