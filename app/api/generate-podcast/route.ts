import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { DEFAULT_VOICE1, DEFAULT_VOICE2, resolveTtsModel, resolveTtsChunkChars, CHUNK_GAP_MS } from '@/lib/constants';
import { logUsage, getEmailFromRequest } from '@/lib/usageLogger';
import {
  extractDialogue,
  extractSoloScript,
  splitScriptIntoChunks,
} from '@/lib/scriptFormat';
import { postprocessChunks } from '@/lib/ttsPostprocess';

export const maxDuration = 600;

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

// I4: PCM silence trimming — works on Int16 LE PCM data (Uint8Array views)

function trimLeadingSilence(pcm: Uint8Array, threshold = 200, maxTrimMs = 300, sampleRate = 24000): Uint8Array {
  if (pcm.byteLength < 2) return pcm;
  const maxTrimSamples = Math.floor((maxTrimMs / 1000) * sampleRate);
  const dv = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let startAt = 0;
  while (startAt < maxTrimSamples && (startAt + 1) * 2 <= pcm.byteLength) {
    const amp = Math.abs(dv.getInt16(startAt * 2, true));
    if (amp > threshold) break;
    startAt++;
  }
  return pcm.subarray(startAt * 2);
}

function trimTrailingSilence(pcm: Uint8Array, threshold = 200, minKeepMs = 80, sampleRate = 24000): Uint8Array {
  if (pcm.byteLength < 2) return pcm;
  const minKeepSamples = Math.floor((minKeepMs / 1000) * sampleRate);
  const totalSamples   = Math.floor(pcm.byteLength / 2);
  const dv = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let cutAt = totalSamples - minKeepSamples;
  while (cutAt > 0) {
    const amp = Math.abs(dv.getInt16((cutAt - 1) * 2, true));
    if (amp > threshold) break;
    cutAt--;
  }
  return pcm.subarray(0, Math.max(cutAt, minKeepSamples) * 2);
}

// Insert fixed-length silence (all-zero Int16 LE PCM) between chunks
function createSilence(durationMs: number, sampleRate: number): Uint8Array {
  const samples = Math.floor((durationMs / 1000) * sampleRate);
  return new Uint8Array(samples * 2); // Int16 LE，全 0 = 靜音
}

function concatPcmChunks(pcmChunks: Uint8Array[], sampleRate: number): Uint8Array {
  const totalLength = pcmChunks.reduce((acc, c) => acc + c.byteLength, 0);
  const totalPcm = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of pcmChunks) {
    totalPcm.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return pcmToWav(totalPcm, sampleRate);
}

function makeWavResponse(wavData: Uint8Array): NextResponse {
  // pcmToWav always creates a fresh ArrayBuffer, so .buffer is ArrayBuffer (not SharedArrayBuffer).
  // The cast is safe; avoids Uint8Array<ArrayBufferLike> vs BodyInit TS generics conflict.
  return new NextResponse(wavData.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(wavData.byteLength),
      'Content-Disposition': 'attachment; filename="podcast.wav"',
    },
  });
}

// Retry wrapper for Gemini TTS API calls.
// Retries up to maxRetries times with a fixed delay on server-side errors (5xx).
// Client errors (400 INVALID_ARGUMENT etc.) are thrown immediately without retry.
type GenConfig = NonNullable<Parameters<ReturnType<typeof getAI>['models']['generateContent']>[0]['config']>;

async function callTtsApi(
  ai: ReturnType<typeof getAI>,
  modelName: string,
  text: string,
  speechConfig: GenConfig['speechConfig'],
  maxRetries = 2,
  retryDelayMs = 2000,
): Promise<{ audioData: string; mimeType: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(res => setTimeout(res, retryDelayMs));
      console.log(`[generate-podcast] retry attempt ${attempt}/${maxRetries}`);
    }
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ parts: [{ text }] }],
        config: { responseModalities: ['AUDIO'], speechConfig },
      });
      const part = response.candidates?.[0]?.content?.parts?.[0];
      const audioData = part?.inlineData?.data;
      if (!audioData) throw new Error('No audio data returned');
      const mimeType = part?.inlineData?.mimeType ?? 'audio/L16;rate=24000';
      return { audioData, mimeType };
    } catch (err: unknown) {
      lastErr = err;
      // Don't retry client-side errors (400 INVALID_ARGUMENT, auth errors, etc.)
      const msg = err instanceof Error ? err.message : String(err);
      if (/"code":\s*4\d\d/.test(msg) || /INVALID_ARGUMENT|RequestAuthError|Missing API Key/.test(msg)) {
        throw err;
      }
      console.warn(`[generate-podcast] TTS attempt ${attempt + 1} failed: ${msg}`);
    }
  }
  throw lastErr;
}

export async function POST(req: NextRequest) {
  try {
    logUsage(getEmailFromRequest(req), 'generate-podcast');
    const ai = getAI(req);
    const { script, voice1 = DEFAULT_VOICE1, voice2 = DEFAULT_VOICE2, ttsModel, narrationMode = 'duo', contentLanguage, ttsGenerationMode = 'single' } = await req.json();
    const modelName = resolveTtsModel(ttsModel);
    const isDuo = narrationMode === 'duo';

    // I5: User choice drives chunking; env flag acts as server capability guard only.
    // Frontend hides the 'chunked' option when ttsChunkingEnabled=false, so this
    // fallback only triggers if the request bypasses the UI (e.g. manual API call).
    const serverAllowsChunking = process.env.TTS_CHUNKING_ENABLED === 'true';
    const chunkingEnabled = ttsGenerationMode === 'chunked' && serverAllowsChunking;

    // plan_B: per-language multiplier so each chunk produces ~145-160s of audio
    // regardless of contentLanguage. Legacy records without contentLanguage fall
    // back to 800 (zh-TW baseline).
    const effectiveChunkChars = resolveTtsChunkChars(contentLanguage);
    console.log(
      `[generate-podcast] contentLanguage=${contentLanguage ?? 'zh-TW'} ` +
      `narrationMode=${narrationMode} ` +
      `effectiveChunkChars=${effectiveChunkChars}`,
    );

    let chunks: string[];
    try {
      chunks = chunkingEnabled
        ? splitScriptIntoChunks(script, effectiveChunkChars)
        : [script];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('CHUNK_TOO_LONG:')) {
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      throw err;
    }

    const speechConfig = isDuo
      ? {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              { speaker: 'Speaker 1', voiceConfig: { prebuiltVoiceConfig: { voiceName: voice1 } } },
              { speaker: 'Speaker 2', voiceConfig: { prebuiltVoiceConfig: { voiceName: voice2 } } },
            ],
          },
        }
      : {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice1 } },
        };

    // Single chunk path (short circuit — zero extra overhead)
    if (chunks.length === 1) {
      const dialogue = isDuo ? extractDialogue(chunks[0]) : extractSoloScript(chunks[0]);
      if (!dialogue) {
        return NextResponse.json({ error: 'No dialogue lines found in script' }, { status: 400 });
      }

      const { audioData, mimeType } = await callTtsApi(ai, modelName, dialogue, speechConfig);
      const rateMatch = mimeType.match(/rate=(\d+)/);
      const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;

      const pcmData = Buffer.from(audioData, 'base64');
      const wavData = pcmToWav(new Uint8Array(pcmData), sampleRate);

      console.log(`[generate-podcast] mode=${narrationMode} sampleRate=${sampleRate} wavBytes=${wavData.byteLength}`);

      return makeWavResponse(wavData);
    }

    // Multi-chunk path
    const postprocessingEnabled =
      process.env.TTS_CHUNK_POSTPROCESSING_ENABLED === 'true';

    // Raw PCM (post silence-trim) per chunk. When postprocessing is enabled we
    // hand these to ttsPostprocess which runs FFmpeg-based gain match +
    // boundary crossfade + final loudnorm. When disabled we fall back to the
    // original concat-with-fixed-silence path.
    const rawChunks: Uint8Array[] = [];
    const pcmChunks: Uint8Array[] = [];
    let baseSampleRate = 24000;
    let baseMimeType   = '';

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = isDuo ? extractDialogue(chunks[i]) : extractSoloScript(chunks[i]);
      if (!chunkText) continue;

      const { audioData, mimeType } = await callTtsApi(ai, modelName, chunkText, speechConfig)
        .catch((err: unknown) => { throw new Error(`Chunk ${i + 1}/${chunks.length} 失敗：${err instanceof Error ? err.message : String(err)}`); });
      const rateMatch  = mimeType.match(/rate=(\d+)/);
      const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;

      if (i === 0) {
        baseSampleRate = sampleRate;
        baseMimeType   = mimeType;
      } else {
        if (sampleRate !== baseSampleRate) {
          throw new Error(`Chunk ${i + 1} sample rate ${sampleRate} 與第一段 ${baseSampleRate} 不一致`);
        }
        if (mimeType !== baseMimeType) {
          throw new Error(`Chunk ${i + 1} mimeType ${mimeType} 與第一段 ${baseMimeType} 不一致`);
        }
      }

      let pcm: Uint8Array = new Uint8Array(Buffer.from(audioData, 'base64'));
      if (i > 0)                   pcm = trimLeadingSilence(pcm, 200, 300, baseSampleRate);
      if (i < chunks.length - 1)   pcm = trimTrailingSilence(pcm, 200, 80, baseSampleRate);

      rawChunks.push(pcm);
      pcmChunks.push(pcm);
      if (i < chunks.length - 1)   pcmChunks.push(createSilence(CHUNK_GAP_MS, baseSampleRate));

      console.log(`[generate-podcast] chunk ${i + 1}/${chunks.length} mode=${narrationMode} sampleRate=${sampleRate} pcmBytes=${pcm.byteLength}`);
    }

    if (pcmChunks.length === 0) {
      return NextResponse.json({ error: 'No audio data returned from any chunk' }, { status: 502 });
    }

    if (postprocessingEnabled && rawChunks.length >= 2) {
      try {
        const started = Date.now();
        const { wav, metrics } = await postprocessChunks(rawChunks, {
          sampleRate: baseSampleRate,
        });
        console.log(
          `[generate-podcast] postprocess ok mode=${narrationMode} ` +
          `chunks=${rawChunks.length} wavBytes=${wav.byteLength} ` +
          `totalMs=${Date.now() - started} analyzeMs=${metrics.analyzeMs} ` +
          `gainMs=${metrics.gainMs} mergeMs=${metrics.mergeMs} ` +
          `loudnormMs=${metrics.loudnormMs} ` +
          `chunkLufs=${JSON.stringify(metrics.chunkLufs)} ` +
          `gainAppliedDb=${JSON.stringify(metrics.chunkGainAppliedDb)} ` +
          `mergeStrategy=${metrics.mergeStrategy} ` +
          `loudnormApplied=${metrics.finalLoudnormApplied}`,
        );
        return makeWavResponse(wav);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[generate-podcast] postprocess failed: ${msg}`);
        // Per plan §12: surface postprocess failures as 502 during early rollout
        // rather than silently returning the lower-quality concat output.
        return NextResponse.json(
          { error: `Chunk 音檔後製失敗：${msg}` },
          { status: 502 },
        );
      }
    }

    const wavData = concatPcmChunks(pcmChunks, baseSampleRate);
    console.log(`[generate-podcast] concat ${pcmChunks.length} chunks mode=${narrationMode} wavBytes=${wavData.byteLength}`);

    return makeWavResponse(wavData);

  } catch (err: unknown) {
    if (err instanceof Error && (err.message === 'Missing API Key' || err.name === 'RequestAuthError')) {
      return unauthorizedResponse(err);
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
