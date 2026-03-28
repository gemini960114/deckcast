import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { MODEL_TTS, DEFAULT_VOICE1, DEFAULT_VOICE2 } from '@/lib/constants';

export const maxDuration = 300;

function pcmToWav(pcmData: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);          // chunk size
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer).set(pcmData, 44);
  return new Uint8Array(buffer);
}

// Keep only 風格 and Speaker lines; strip parenthetical names; use single newlines.
function extractDialogue(script: string): string {
  return script
    .split('\n')
    .filter(line => {
      const t = line.trim();
      return /^風格[：:]/.test(t) || /^Speaker\s+\d+/i.test(t);
    })
    .map(line => line.replace(/^(Speaker\s+\d+)\s*\([^)]*\)\s*:/i, '$1:'))
    .join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const ai = getAI(req);
    const { script, voice1 = DEFAULT_VOICE1, voice2 = DEFAULT_VOICE2 } = await req.json();

    const dialogue = extractDialogue(script);
    if (!dialogue) {
      return NextResponse.json({ error: 'No dialogue lines found in script' }, { status: 400 });
    }

    const response = await ai.models.generateContent({
      model: MODEL_TTS,
      contents: [{ parts: [{ text: dialogue }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              { speaker: 'Speaker 1', voiceConfig: { prebuiltVoiceConfig: { voiceName: voice1 } } },
              { speaker: 'Speaker 2', voiceConfig: { prebuiltVoiceConfig: { voiceName: voice2 } } },
            ],
          },
        },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    if (!audioData) {
      return NextResponse.json({ error: 'No audio data returned' }, { status: 502 });
    }

    const mimeType = part?.inlineData?.mimeType ?? 'audio/L16;rate=24000';
    const rateMatch = mimeType.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;

    // Use Buffer.from for efficient server-side base64 decode (avoids atob char loop)
    const pcmData = Buffer.from(audioData, 'base64');
    const wavData = pcmToWav(new Uint8Array(pcmData), sampleRate);

    return new NextResponse(wavData, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wavData.byteLength),
        'Content-Disposition': 'attachment; filename="podcast.wav"',
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Missing API Key') {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
