import { NextRequest, NextResponse } from 'next/server';
import { getAI, unauthorizedResponse } from '@/lib/getAI';
import { DEFAULT_VOICE1, DEFAULT_VOICE2, resolveTtsModel, TTS_CHUNK_CHARS, CHUNK_GAP_MS } from '@/lib/constants';
import { logUsage, getEmailFromRequest } from '@/lib/usageLogger';

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

// Duo: keep 風格 + Speaker N lines; strip parenthetical names.
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

// Solo: extract style instruction + strip "Speaker 1:" prefix from dialogue lines.
// Returns a prompt shaped like the Python single-speaker TTS example:
//   Read the following script... Style: <風格>. Do not read the word "Script:".
//   Script:
//   <line1>
//   <line2>
function extractSoloScript(script: string): string {
  const lines = script.split('\n').map(l => l.trim()).filter(Boolean);

  const styleLine = lines.find(l => /^風格[：:]/.test(l));
  const styleText = styleLine ? styleLine.replace(/^風格[：:]\s*/, '').trim() : '';

  const dialogueLines = lines
    .filter(l => /^Speaker\s+1\s*(\([^)]*\))?\s*:/i.test(l))
    .map(l => l.replace(/^Speaker\s+1\s*(\([^)]*\))?\s*:\s*/i, ''))
    .filter(Boolean);

  if (!dialogueLines.length) return '';

  const instruction = styleText
    ? `Read the following script naturally. Do not read the word "Script:" or any metadata. Style guidance: ${styleText}\n\nScript:\n`
    : `Read the following script naturally. Do not read the word "Script:" or any metadata.\n\nScript:\n`;

  return instruction + dialogueLines.join('\n');
}

// I3: Two-layer script splitting
// Layer 1: split at slide boundaries, keeping each chunk ≤ maxChars dialogue chars
// Layer 2: if a single slide exceeds maxChars, split by Speaker lines within that slide
// Layer 3: if a single Speaker line exceeds maxChars, throw CHUNK_TOO_LONG
function splitScriptIntoChunks(script: string, maxChars: number): string[] {
  const styleMatch = script.match(/^風格[：:][^\n]*/m);
  const styleLine  = styleMatch ? styleMatch[0] : '';

  // Remove styleLine from script before splitting to avoid duplication in first chunk
  const scriptWithoutStyle = styleLine
    ? script.replace(styleLine, '').replace(/^\n+/, '')
    : script;

  const rawBlocks = scriptWithoutStyle.split(/(?=\n?投影片\s+\d+[：:])/);

  const chunks: string[] = [];

  function pushChunk(lines: string[]) {
    const content = lines.join('\n').trim();
    if (content) chunks.push(content);
  }

  let currentLines: string[] = styleLine ? [styleLine] : [];
  let currentChars = 0;

  for (const block of rawBlocks) {
    if (!block.trim()) continue;

    // Skip blocks with no Speaker lines (e.g. leading whitespace blocks)
    const hasSpeakerLine = /^Speaker\s+\d+/im.test(block);
    if (!hasSpeakerLine) continue;

    const blockSpeakerLines = block
      .split('\n')
      .filter(l => /^Speaker\s+\d+/i.test(l.trim()));

    const blockChars = blockSpeakerLines
      .map(l => l.replace(/^Speaker\s+\d+\s*(\([^)]*\))?\s*:\s*/i, '').trim())
      .reduce((sum, l) => sum + l.length, 0);

    // Layer 1: whole slide fits within limit
    if (blockChars <= maxChars) {
      if (currentChars + blockChars > maxChars && currentChars > 0) {
        pushChunk(currentLines);
        currentLines = styleLine ? [styleLine] : [];
        currentChars = 0;
      }
      currentLines.push(block);
      currentChars += blockChars;

    } else {
      // Layer 2: single slide too long — split by Speaker lines
      if (currentChars > 0) {
        pushChunk(currentLines);
        currentLines = styleLine ? [styleLine] : [];
        currentChars = 0;
      }

      // Keep non-Speaker, non-style lines as page header
      const pageHeader = block
        .split('\n')
        .filter(l => !/^Speaker\s+\d+/i.test(l.trim()) && !/^風格[：:]/.test(l.trim()))
        .join('\n');

      let subLines: string[] = [styleLine, pageHeader].filter(Boolean);
      let subChars = 0;

      for (const spLine of blockSpeakerLines) {
        const lineChars = spLine.replace(/^Speaker\s+\d+\s*(\([^)]*\))?\s*:\s*/i, '').trim().length;

        // Layer 3: single sentence exceeds limit — fail fast
        if (lineChars > maxChars) {
          throw new Error(`CHUNK_TOO_LONG: 單句台詞超過 ${maxChars} 字，請重新生成較短的腳本。`);
        }

        if (subChars + lineChars > maxChars && subChars > 0) {
          pushChunk(subLines);
          subLines = [styleLine, pageHeader].filter(Boolean);
          subChars = 0;
        }
        subLines.push(spLine);
        subChars += lineChars;
      }
      if (subLines.length > 0) pushChunk(subLines);
    }
  }

  if (currentLines.length > (styleLine ? 1 : 0)) pushChunk(currentLines);

  return chunks.length > 0 ? chunks : [script];
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
    console.log(`[generate-podcast] contentLanguage=${contentLanguage ?? 'zh-TW'} narrationMode=${narrationMode}`);

    // I5: User choice drives chunking; env flag acts as server capability guard only.
    // Frontend hides the 'chunked' option when ttsChunkingEnabled=false, so this
    // fallback only triggers if the request bypasses the UI (e.g. manual API call).
    const serverAllowsChunking = process.env.TTS_CHUNKING_ENABLED === 'true';
    const chunkingEnabled = ttsGenerationMode === 'chunked' && serverAllowsChunking;

    let chunks: string[];
    try {
      chunks = chunkingEnabled
        ? splitScriptIntoChunks(script, TTS_CHUNK_CHARS)
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
      pcmChunks.push(pcm);
      if (i < chunks.length - 1)   pcmChunks.push(createSilence(CHUNK_GAP_MS, baseSampleRate));

      console.log(`[generate-podcast] chunk ${i + 1}/${chunks.length} mode=${narrationMode} sampleRate=${sampleRate} pcmBytes=${pcm.byteLength}`);
    }

    if (pcmChunks.length === 0) {
      return NextResponse.json({ error: 'No audio data returned from any chunk' }, { status: 502 });
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
