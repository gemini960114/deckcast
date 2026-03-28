import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { buildLyricsPrompt } from '@/lib/prompts';
import { MUSIC_STYLES } from '@/lib/types';
import { stripMarkdown } from '@/lib/stripMarkdown';
import { MODEL_TEXT, DEFAULT_LYRICS_DURATION } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { script, styleId, duration = DEFAULT_LYRICS_DURATION } = await req.json();
    const styleLabel = MUSIC_STYLES.find((s) => s.id === styleId)?.label ?? MUSIC_STYLES[0].label;
    const stylePrompt = buildLyricsPrompt(styleLabel, duration);

    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: [{ parts: [{ text: `${stylePrompt}\n\n${script}` }] }],
    });

    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const lyrics = stripMarkdown(raw);
    return NextResponse.json({ lyrics });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Missing API Key') {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
