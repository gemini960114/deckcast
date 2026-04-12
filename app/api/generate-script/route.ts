import { NextRequest, NextResponse } from 'next/server';
import { buildNarrationPrompt } from '@/lib/prompts';
import { stripMarkdown } from '@/lib/stripMarkdown';
import { unauthorizedResponse } from '@/lib/getAI';
import { generateText } from '@/lib/llm';
import type { NarrationMode, ContentLanguage } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const { slides, speaker1, speaker2, dialogueStyle, tone, textModel, narrationMode = 'duo', contentLanguage } = await req.json();
    const prompt = buildNarrationPrompt({
      mode: narrationMode as NarrationMode,
      speaker1,
      speaker2,
      dialogueStyle,
      tone,
      language: contentLanguage as ContentLanguage | undefined,
    });

    const raw = await generateText(req, {
      model: textModel,
      prompt: `${prompt}\n\n${slides}`,
    });
    const script = stripMarkdown(raw);
    if (!script.trim()) {
      return NextResponse.json({ error: '模型未回傳任何 Podcast 文稿內容。' }, { status: 502 });
    }
    return NextResponse.json({ script });
  } catch (err: unknown) {
    if (err instanceof Error && (err.message === 'Missing API Key' || err.name === 'RequestAuthError')) {
      return unauthorizedResponse(err);
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
