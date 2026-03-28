import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { buildPodcastPrompt } from '@/lib/prompts';
import { stripMarkdown } from '@/lib/stripMarkdown';
import { MODEL_TEXT } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { slides, speaker1, speaker2, dialogueStyle, tone } = await req.json();
    const prompt = buildPodcastPrompt({ speaker1, speaker2, dialogueStyle, tone });

    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: [{ parts: [{ text: `${prompt}\n\n${slides}` }] }],
    });

    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const script = stripMarkdown(raw);
    return NextResponse.json({ script });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Missing API Key') {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
