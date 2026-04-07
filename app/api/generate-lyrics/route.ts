import { NextRequest, NextResponse } from 'next/server';
import { buildLyricsPrompt } from '@/lib/prompts';
import { MUSIC_STYLES } from '@/lib/types';
import { stripMarkdown } from '@/lib/stripMarkdown';
import { DEFAULT_LYRICS_DURATION } from '@/lib/constants';
import { unauthorizedResponse } from '@/lib/getAI';
import { generateText } from '@/lib/llm';

export async function POST(req: NextRequest) {
  try {
    const { script, styleId, duration = DEFAULT_LYRICS_DURATION, textModel } = await req.json();
    const styleLabel = MUSIC_STYLES.find((s) => s.id === styleId)?.label ?? MUSIC_STYLES[0].label;
    const stylePrompt = buildLyricsPrompt(styleLabel, duration);

    const raw = await generateText(req, {
      model: textModel,
      prompt: `${stylePrompt}\n\n${script}`,
    });
    const lyrics = stripMarkdown(raw);
    if (!lyrics.trim()) {
      return NextResponse.json({ error: '模型未回傳任何歌詞內容。' }, { status: 502 });
    }
    return NextResponse.json({ lyrics });
  } catch (err: unknown) {
    if (err instanceof Error && (err.message === 'Missing API Key' || err.name === 'RequestAuthError')) {
      return unauthorizedResponse(err);
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
