import { NextRequest, NextResponse } from 'next/server';
import { buildLyricsPrompt } from '@/lib/prompts';
import { MUSIC_STYLES } from '@/lib/types';
import { stripMarkdown } from '@/lib/stripMarkdown';
import { DEFAULT_LYRICS_DURATION } from '@/lib/constants';
import { unauthorizedResponse } from '@/lib/getAI';
import { generateText } from '@/lib/llm';
import { logUsage, getEmailFromRequest } from '@/lib/usageLogger';
import type { ContentLanguage } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    logUsage(getEmailFromRequest(req), 'generate-lyrics');
    const { script, lyricsSource, styleId, duration = DEFAULT_LYRICS_DURATION, textModel, contentLanguage } = await req.json();
    // lyricsSource takes priority: solo modes pass slides text to avoid mode-script tone pollution
    const content = (lyricsSource ?? script) as string;
    const styleLabel = MUSIC_STYLES.find((s) => s.id === styleId)?.label ?? MUSIC_STYLES[0].label;
    const stylePrompt = buildLyricsPrompt(styleLabel, duration, contentLanguage as ContentLanguage | undefined);

    const raw = await generateText(req, {
      model: textModel,
      prompt: `${stylePrompt}\n\n${content}`,
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
