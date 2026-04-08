import { NextRequest } from 'next/server';
import { resolveTextModelOption } from './constants';
import { getGeminiAI } from './getAI';
import { requireSession } from './auth';

function getLocalLlmBaseUrl(): string {
  return (process.env.LOCAL_LLM_BASE_URL ?? '').trim();
}

function getLocalLlmApiKey(): string {
  return (process.env.LOCAL_LLM_API_KEY ?? '').trim();
}

function getLocalLlmModel(): string {
  return (process.env.LOCAL_LLM_MODEL ?? '').trim();
}

export function getLocalLlmLabel(): string {
  const label = (process.env.LOCAL_LLM_LABEL ?? '').trim();
  if (label) return label;

  const model = getLocalLlmModel();
  if (model) return model;

  return 'Gemma 4';
}

function getLocalChatCompletionsUrl(): string {
  const baseUrl = getLocalLlmBaseUrl();
  if (!baseUrl) {
    throw new Error('Missing LOCAL_LLM_BASE_URL');
  }

  if (/\/chat\/completions\/?$/i.test(baseUrl)) {
    return baseUrl;
  }

  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

export function isLocalLlmConfigured(): boolean {
  return Boolean(getLocalLlmBaseUrl() && getLocalLlmApiKey());
}

export function modelNeedsGemini(model?: string): boolean {
  return resolveTextModelOption(model).provider === 'gemini';
}

export async function generateText(req: NextRequest, params: {
  model?: string;
  prompt: string;
  expectJson?: boolean;
}): Promise<string> {
  requireSession(req);
  const requestedModel = resolveTextModelOption(params.model);

  if (requestedModel.provider === 'gemini') {
    const ai = getGeminiAI(req);
    const response = await ai.models.generateContent({
      model: requestedModel.model,
      contents: [{ parts: [{ text: params.prompt }] }],
      ...(params.expectJson ? { config: { responseMimeType: 'application/json' } } : {}),
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  if (!isLocalLlmConfigured()) {
    throw new Error('Missing LOCAL_LLM_BASE_URL or LOCAL_LLM_API_KEY');
  }

  const model = getLocalLlmModel() || requestedModel.model;

  const response = await fetch(getLocalChatCompletionsUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getLocalLlmApiKey()}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: params.prompt,
        },
      ],
      temperature: 0.2,
    }),
  });

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`Local LLM error: ${payloadText}`);
  }

  let payload: {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };

  try {
    payload = JSON.parse(payloadText) as typeof payload;
  } catch {
    throw new Error('Local LLM returned invalid JSON');
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(item => item.text ?? '')
      .join('')
      .trim();
  }

  return '';
}
