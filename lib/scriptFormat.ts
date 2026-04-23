// Podcast script preamble / chunking utilities.
//
// Supports two preamble formats:
//
//   (new) # AUDIO PROFILE
//         ## Speaker1: <persona>
//         Style: ...
//         Accent: ...
//         Pacing: ...
//         [optional ## Speaker2 block for duo mode]
//         # SCENE
//         ...
//         # SAMPLE CONTEXT
//         ...
//
//   (legacy) 風格: ...
//
// Everything in this module treats both formats as equivalent at the surface
// contract level, so callers in route.ts don't need branching.

// Match the whole AUDIO PROFILE block.
//
// The first branch stops lazily right before the first `投影片 N：` marker.
// The second branch handles scripts that don't contain a slide marker yet
// (defensive fallback so the preamble still parses during partial generation).
//
// Note: we can't use `|$` inside a lookahead with the /m flag because `$`
// matches end-of-line, which would make the lazy quantifier stop at the first
// newline. Separate alternations force the greedy second branch to take over
// only when no slide marker is found.
export const PREAMBLE_BLOCK_RE =
  /^#\s*AUDIO PROFILE[\s\S]*?(?=\n投影片\s+\d+[：:])|^#\s*AUDIO PROFILE[\s\S]*/m;

// Match the legacy single-line 風格:
export const LEGACY_STYLE_LINE_RE = /^風格[：:][^\n]*/m;

// Lines that should be filtered out of fallback SRTs (used by align-podcast).
// Matches both new preamble markers and the legacy 風格: line plus 投影片 N:.
export const PREAMBLE_LINE_RE =
  /^(風格\s*[:：]|#\s*(AUDIO PROFILE|SCENE|SAMPLE CONTEXT)\s*$|##\s*Speaker[12]\s*[:：]|Style\s*[:：]|Accent\s*[:：]|Pacing\s*[:：]|投影片\s*\d+\s*[:：])/;

export interface SpeakerProfile {
  persona: string;
  style: string;
  accent: string;
  pacing: string;
}

export type NarrationDirection = 'duo' | 'solo';

/** Return the preamble text (trimmed) or empty string. Supports both formats. */
export function extractPreamble(script: string): string {
  if (!script) return '';
  const newMatch = script.match(PREAMBLE_BLOCK_RE);
  if (newMatch) return newMatch[0].trim();
  const legacy = script.match(LEGACY_STYLE_LINE_RE);
  return legacy ? legacy[0].trim() : '';
}

/**
 * Extract a single Speaker{n} block from an AUDIO PROFILE preamble.
 * Returns null if the block is missing. Missing Style/Accent/Pacing become empty strings.
 */
export function extractSpeakerBlock(
  preamble: string,
  n: 1 | 2,
): SpeakerProfile | null {
  if (!preamble) return null;
  // Look for `## SpeakerN: <persona>` and capture everything until the next
  // `## SpeakerX:`, a level-1 heading, a slide marker, or end of string.
  const headerRe = new RegExp(
    `^##\\s*Speaker${n}\\s*[:：]\\s*(.*)$`,
    'im',
  );
  const headerMatch = preamble.match(headerRe);
  if (!headerMatch || headerMatch.index === undefined) return null;

  const afterHeader = preamble.slice(
    headerMatch.index + headerMatch[0].length,
  );
  const stopRe = /\n##\s*Speaker[12]\s*[:：]|\n#\s|\n投影片\s+\d+[：:]/;
  const stopMatch = afterHeader.match(stopRe);
  const body = stopMatch
    ? afterHeader.slice(0, stopMatch.index)
    : afterHeader;

  const pick = (label: string): string => {
    const r = new RegExp(`^${label}\\s*[:：]\\s*(.+)$`, 'im');
    const m = body.match(r);
    return m ? m[1].trim() : '';
  };

  return {
    persona: headerMatch[1].trim(),
    style: pick('Style'),
    accent: pick('Accent'),
    pacing: pick('Pacing'),
  };
}

/**
 * Legacy helper (kept exported for tests and as an escape hatch):
 * flatten an AUDIO PROFILE preamble into plain-text delivery guidance.
 *
 * NOTE: As of the Python-parity fix, this is NOT used by extractDialogue
 * or extractSoloScript. The verified-working pattern is to forward the
 * preamble markdown verbatim to Gemini TTS, which handles multi-speaker
 * attribution natively via multiSpeakerVoiceConfig and does not read the
 * `#` / `##` headings aloud.
 *
 * The function is retained so external callers (or future experimentation)
 * can still produce a compressed directive if needed.
 */
export function summarizePreambleForTts(
  preamble: string,
  mode: NarrationDirection,
): string {
  if (!preamble) return '';

  const isNew = /^#\s*AUDIO PROFILE/m.test(preamble);
  if (!isNew && LEGACY_STYLE_LINE_RE.test(preamble)) {
    return preamble.replace(/^風格[：:]\s*/, '').trim();
  }

  const parts: string[] = [];
  const s1 = extractSpeakerBlock(preamble, 1);
  if (s1) {
    const detail = [s1.style, s1.accent, s1.pacing]
      .filter(Boolean)
      .join(' ');
    parts.push(
      detail
        ? `Make Speaker 1 sound like ${s1.persona}. ${detail}`
        : `Make Speaker 1 sound like ${s1.persona}.`,
    );
  }
  if (mode === 'duo') {
    const s2 = extractSpeakerBlock(preamble, 2);
    if (s2) {
      const detail = [s2.style, s2.accent, s2.pacing]
        .filter(Boolean)
        .join(' ');
      parts.push(
        detail
          ? `Make Speaker 2 sound like ${s2.persona}. ${detail}`
          : `Make Speaker 2 sound like ${s2.persona}.`,
      );
    }
  }
  return parts.join('\n');
}

/**
 * Duo TTS input: full preamble markdown (verbatim) + Speaker N: dialogue lines.
 *
 * Matches the verified-working Python reference: Gemini's multi-speaker TTS
 * attributes voices via `multiSpeakerVoiceConfig.speakerVoiceConfigs` and
 * reads the AUDIO PROFILE markdown as delivery context without speaking the
 * `#` / `##` / `Style:` markers aloud. Attempting to compress the preamble
 * into a custom `Make Speaker N sound like ...` directive — or to wrap it
 * with synthetic tags like `[Voice direction — do not read this block aloud]`
 * — breaks the model and causes empty/error responses that surface as
 * `TypeError: Failed to fetch` on the client.
 *
 * Parenthetical speaker names like `Speaker 1 (主持人):` are still stripped
 * so the `speakerVoiceConfigs` speaker label match stays exact.
 */
export function extractDialogue(script: string): string {
  const preamble = extractPreamble(script);

  const dialogueLines = script
    .split('\n')
    .filter(line => /^Speaker\s+\d+/i.test(line.trim()))
    .map(line => line.replace(/^(Speaker\s+\d+)\s*\([^)]*\)\s*:/i, '$1:'))
    .join('\n');

  if (!dialogueLines) return '';
  return preamble ? `${preamble}\n\n${dialogueLines}` : dialogueLines;
}

/**
 * Solo TTS input: `Read the following script ... Script: <lines>`.
 *
 * The preamble (if any) is embedded as a `Delivery profile:` block between
 * the base instruction and the `Script:` block. The Speaker 1: prefix is
 * stripped from each dialogue line because single-speaker TTS does not use
 * `speakerVoiceConfigs` and would otherwise read the prefix aloud.
 */
export function extractSoloScript(script: string): string {
  const preamble = extractPreamble(script);

  const dialogueLines = script
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^Speaker\s+1\s*(\([^)]*\))?\s*:/i.test(l))
    .map(l => l.replace(/^Speaker\s+1\s*(\([^)]*\))?\s*:\s*/i, ''))
    .filter(Boolean);

  if (!dialogueLines.length) return '';

  const base =
    'Read the following script naturally. Do not read the word "Script:" or any metadata.';
  const instruction = preamble
    ? `${base}\n\nDelivery profile:\n${preamble}\n\nScript:\n`
    : `${base}\n\nScript:\n`;

  return instruction + dialogueLines.join('\n');
}

/**
 * Split a script into TTS chunks whose dialogue char count does not exceed
 * `maxChars`. The preamble is preserved verbatim and re-prepended to every
 * chunk so TTS voice characteristics stay consistent across chunks.
 *
 * Layer 1: slide boundaries  (fast path)
 * Layer 2: Speaker-line boundaries within an oversize slide
 * Layer 3: throw CHUNK_TOO_LONG if a single Speaker line exceeds maxChars
 */
export function splitScriptIntoChunks(
  script: string,
  maxChars: number,
): string[] {
  const preamble = extractPreamble(script);
  const preambleLines: string[] = preamble ? [preamble] : [];

  const scriptWithoutPreamble = preamble
    ? script.replace(preamble, '').replace(/^\n+/, '')
    : script;

  const rawBlocks = scriptWithoutPreamble.split(/(?=\n?投影片\s+\d+[：:])/);

  const chunks: string[] = [];

  function pushChunk(lines: string[]) {
    const content = lines.join('\n').trim();
    if (content) chunks.push(content);
  }

  let currentLines: string[] = [...preambleLines];
  let currentChars = 0;

  const baseLen = preambleLines.length;

  for (const block of rawBlocks) {
    if (!block.trim()) continue;

    const hasSpeakerLine = /^Speaker\s+\d+/im.test(block);
    if (!hasSpeakerLine) continue;

    const blockSpeakerLines = block
      .split('\n')
      .filter(l => /^Speaker\s+\d+/i.test(l.trim()));

    const blockChars = blockSpeakerLines
      .map(l => l.replace(/^Speaker\s+\d+\s*(\([^)]*\))?\s*:\s*/i, '').trim())
      .reduce((sum, l) => sum + l.length, 0);

    if (blockChars <= maxChars) {
      if (currentChars + blockChars > maxChars && currentChars > 0) {
        pushChunk(currentLines);
        currentLines = [...preambleLines];
        currentChars = 0;
      }
      currentLines.push(block);
      currentChars += blockChars;
    } else {
      if (currentChars > 0) {
        pushChunk(currentLines);
        currentLines = [...preambleLines];
        currentChars = 0;
      }

      // Per-slide "header" lines are non-Speaker lines that are also not
      // preamble / legacy-風格: lines.
      const pageHeader = block
        .split('\n')
        .filter(
          l =>
            !/^Speaker\s+\d+/i.test(l.trim()) &&
            !/^風格[：:]/.test(l.trim()) &&
            !PREAMBLE_LINE_RE.test(l.trim()),
        )
        .join('\n');

      let subLines: string[] = [...preambleLines, pageHeader].filter(Boolean);
      let subChars = 0;

      for (const spLine of blockSpeakerLines) {
        const lineChars = spLine
          .replace(/^Speaker\s+\d+\s*(\([^)]*\))?\s*:\s*/i, '')
          .trim().length;

        if (lineChars > maxChars) {
          throw new Error(
            `CHUNK_TOO_LONG: 單句台詞超過 ${maxChars} 字，請重新生成較短的腳本。`,
          );
        }

        if (subChars + lineChars > maxChars && subChars > 0) {
          pushChunk(subLines);
          subLines = [...preambleLines, pageHeader].filter(Boolean);
          subChars = 0;
        }
        subLines.push(spLine);
        subChars += lineChars;
      }
      if (subLines.length > 0) pushChunk(subLines);
    }
  }

  if (currentLines.length > baseLen) pushChunk(currentLines);

  return chunks.length > 0 ? chunks : [script];
}
