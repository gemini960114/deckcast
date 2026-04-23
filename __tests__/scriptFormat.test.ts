import { describe, it, expect } from 'vitest';
import {
  PREAMBLE_LINE_RE,
  extractPreamble,
  extractSpeakerBlock,
  summarizePreambleForTts,
  extractDialogue,
  extractSoloScript,
  splitScriptIntoChunks,
} from '@/lib/scriptFormat';

// --- Fixtures -----------------------------------------------------------

const LEGACY_DUO_SCRIPT = [
  '風格: 輕鬆對談、帶點幽默',
  '',
  '投影片 1：什麼是 RAG？',
  'Speaker 1 (主持人): 大家好，今天要聊 RAG。',
  'Speaker 2 (專家): 沒錯，RAG 是 Retrieval-Augmented Generation。',
  '投影片 2：三大步驟',
  'Speaker 1: 第一步是檢索。',
  'Speaker 2: 第二步是增強。',
].join('\n');

const NEW_DUO_SCRIPT = [
  '# AUDIO PROFILE',
  '',
  '## Speaker1: 「充滿熱情的新手主持」',
  'Style: 語氣活潑、好奇心滿滿、很愛追問細節。',
  'Accent: 台灣口音，帶點年輕感。',
  'Pacing: 節奏明快、有推進感。',
  '',
  '## Speaker2: 「溫暖知性的資深導師」',
  'Style: 聲音帶笑意、耐心、愛舉生活化比喻。',
  'Accent: 標準華語、字正腔圓。',
  'Pacing: 沉穩流動、不搶拍。',
  '',
  '# SCENE',
  '一個午後的 Podcast 錄音間，窗外陽光灑進來。',
  '',
  '# SAMPLE CONTEXT',
  'Speaker1 剛剛讀完 Ken 老師的小抄，興奮地想和聽眾分享。',
  'Speaker2 面帶微笑，準備接住年輕人的熱情。',
  '',
  '投影片 1：Ken 老師的 NotebookLM 教學心法',
  'Speaker 1: 大家好，這份小抄超實用！',
  'Speaker 2: 沒錯，而且作者歡迎轉傳。',
  '投影片 2：Line 共學社群',
  'Speaker 1: 記得加入「AI 簡報學習圈」喔。',
  'Speaker 2: 連結在投影片上。',
].join('\n');

const NEW_SOLO_SCRIPT = [
  '# AUDIO PROFILE',
  '',
  '## Speaker1: 「沉穩的說書人」',
  'Style: 低沉、溫暖、有故事感。',
  'Accent: 標準華語。',
  'Pacing: 緩慢、留白、有呼吸。',
  '',
  '# SCENE',
  '深夜的書房，一盞昏黃的檯燈。',
  '',
  '# SAMPLE CONTEXT',
  'Speaker1 準備向聽眾講述一段歷史。',
  '',
  '投影片 1：歷史的開端',
  'Speaker 1: 故事要從很久很久以前說起。',
  '投影片 2：轉折點',
  'Speaker 1: 然後一切都變了。',
].join('\n');

// --- extractPreamble ---------------------------------------------------

describe('extractPreamble', () => {
  it('returns the trimmed legacy 風格: line', () => {
    expect(extractPreamble(LEGACY_DUO_SCRIPT)).toBe('風格: 輕鬆對談、帶點幽默');
  });

  it('returns the full AUDIO PROFILE block for new duo scripts', () => {
    const p = extractPreamble(NEW_DUO_SCRIPT);
    expect(p).toMatch(/^# AUDIO PROFILE/);
    expect(p).toContain('## Speaker1:');
    expect(p).toContain('## Speaker2:');
    expect(p).toContain('# SCENE');
    expect(p).toContain('# SAMPLE CONTEXT');
    // Must not include slide or dialogue lines.
    expect(p).not.toMatch(/^投影片\s+\d/m);
    expect(p).not.toMatch(/^Speaker\s+\d+:/m);
  });

  it('returns the full AUDIO PROFILE block for new solo scripts', () => {
    const p = extractPreamble(NEW_SOLO_SCRIPT);
    expect(p).toMatch(/^# AUDIO PROFILE/);
    expect(p).toContain('## Speaker1:');
    expect(p).not.toContain('## Speaker2:');
  });

  it('returns empty string for an empty input', () => {
    expect(extractPreamble('')).toBe('');
  });

  it('returns empty string when no preamble exists', () => {
    expect(extractPreamble('投影片 1：標題\nSpeaker 1: 你好')).toBe('');
  });
});

// --- extractSpeakerBlock ----------------------------------------------

describe('extractSpeakerBlock', () => {
  const preamble = extractPreamble(NEW_DUO_SCRIPT);

  it('extracts Speaker 1 persona, style, accent, pacing', () => {
    const s1 = extractSpeakerBlock(preamble, 1)!;
    expect(s1).not.toBeNull();
    expect(s1.persona).toBe('「充滿熱情的新手主持」');
    expect(s1.style).toBe('語氣活潑、好奇心滿滿、很愛追問細節。');
    expect(s1.accent).toBe('台灣口音，帶點年輕感。');
    expect(s1.pacing).toBe('節奏明快、有推進感。');
  });

  it('extracts Speaker 2 and does not leak Speaker 1 fields', () => {
    const s1 = extractSpeakerBlock(preamble, 1)!;
    const s2 = extractSpeakerBlock(preamble, 2)!;
    expect(s2).not.toBeNull();
    expect(s2.persona).not.toEqual(s1.persona);
    expect(s2.style).not.toEqual(s1.style);
    expect(s2.pacing).toContain('沉穩');
  });

  it('returns null when the Speaker block is missing', () => {
    const soloPreamble = extractPreamble(NEW_SOLO_SCRIPT);
    expect(extractSpeakerBlock(soloPreamble, 2)).toBeNull();
  });

  it('returns empty strings (not undefined) when labels are absent', () => {
    const partial = [
      '# AUDIO PROFILE',
      '',
      '## Speaker1: 「匿名」',
      '',
      '投影片 1：',
    ].join('\n');
    const s1 = extractSpeakerBlock(partial, 1)!;
    expect(s1.persona).toBe('「匿名」');
    expect(s1.style).toBe('');
    expect(s1.accent).toBe('');
    expect(s1.pacing).toBe('');
  });
});

// --- summarizePreambleForTts ------------------------------------------

describe('summarizePreambleForTts', () => {
  it('legacy: returns text stripped of 風格: prefix', () => {
    const g = summarizePreambleForTts(
      extractPreamble(LEGACY_DUO_SCRIPT),
      'duo',
    );
    expect(g).toBe('輕鬆對談、帶點幽默');
    expect(g).not.toContain('風格:');
  });

  it('new duo: emits both Make Speaker 1/2 sound ... directives', () => {
    const g = summarizePreambleForTts(
      extractPreamble(NEW_DUO_SCRIPT),
      'duo',
    );
    expect(g).toContain('Make Speaker 1 sound');
    expect(g).toContain('Make Speaker 2 sound');
    const idxS1 = g.indexOf('Make Speaker 1 sound');
    const idxS2 = g.indexOf('Make Speaker 2 sound');
    expect(idxS1).toBeGreaterThanOrEqual(0);
    expect(idxS2).toBeGreaterThan(idxS1);
  });

  it('new duo with solo mode: emits only Speaker 1 directive', () => {
    const g = summarizePreambleForTts(
      extractPreamble(NEW_DUO_SCRIPT),
      'solo',
    );
    expect(g).toContain('Make Speaker 1 sound');
    expect(g).not.toContain('Make Speaker 2');
  });

  it('never contains markdown markers or SCENE / SAMPLE CONTEXT text', () => {
    const g = summarizePreambleForTts(
      extractPreamble(NEW_DUO_SCRIPT),
      'duo',
    );
    expect(g).not.toMatch(/^#/m);
    expect(g).not.toMatch(/^##/m);
    expect(g).not.toMatch(/^Style\s*:/m);
    expect(g).not.toMatch(/^Accent\s*:/m);
    expect(g).not.toMatch(/^Pacing\s*:/m);
    expect(g).not.toContain('AUDIO PROFILE');
    expect(g).not.toContain('SCENE');
    expect(g).not.toContain('SAMPLE CONTEXT');
    expect(g).not.toContain('午後的 Podcast 錄音間');
    expect(g).not.toContain('Ken 老師的小抄');
  });

  it('preserves Speaker 1 Style content inside the Speaker 1 directive', () => {
    const g = summarizePreambleForTts(
      extractPreamble(NEW_DUO_SCRIPT),
      'duo',
    );
    const [line1, line2] = g.split('\n');
    expect(line1).toContain('充滿熱情的新手主持');
    expect(line1).toContain('台灣口音');
    expect(line2).toContain('溫暖知性的資深導師');
    expect(line2).toContain('標準華語');
    // Speaker 1 details must not leak into Speaker 2 directive.
    expect(line1).not.toContain('溫暖知性');
    expect(line2).not.toContain('充滿熱情');
  });
});

// --- extractDialogue (duo) --------------------------------------------

describe('extractDialogue', () => {
  it('forwards the full AUDIO PROFILE markdown verbatim (Python-parity contract)', () => {
    const out = extractDialogue(NEW_DUO_SCRIPT);
    // Preamble must arrive unchanged so Gemini's multi-speaker TTS can use it.
    expect(out.startsWith('# AUDIO PROFILE')).toBe(true);
    expect(out).toContain('## Speaker1:');
    expect(out).toContain('## Speaker2:');
    expect(out).toContain('# SCENE');
    expect(out).toContain('# SAMPLE CONTEXT');
    expect(out).toContain('Style:');
    expect(out).toContain('Accent:');
    expect(out).toContain('Pacing:');
    // And dialogue must follow after a blank line.
    expect(out).toMatch(/\n\nSpeaker 1: /);
    // Must NOT contain the old directive/wrapper strings — those break Gemini.
    expect(out).not.toContain('[Voice direction');
    expect(out).not.toContain('[End voice direction]');
    expect(out).not.toContain('Make Speaker 1 sound');
    expect(out).not.toContain('Make Speaker 2 sound');
  });

  it('forwards legacy 風格: preamble verbatim', () => {
    const out = extractDialogue(LEGACY_DUO_SCRIPT);
    expect(out.startsWith('風格: 輕鬆對談、帶點幽默')).toBe(true);
    expect(out).toMatch(/\n\nSpeaker 1: /);
    expect(out).not.toContain('[Voice direction');
  });

  it('preserves Speaker 1 and Speaker 2 dialogue lines', () => {
    const out = extractDialogue(NEW_DUO_SCRIPT);
    expect(out).toMatch(/Speaker 1:\s*大家好/);
    expect(out).toMatch(/Speaker 2:\s*沒錯/);
    expect(out).toMatch(/Speaker 1:\s*記得加入/);
  });

  it('strips parenthetical names like "Speaker 1 (主持人):"', () => {
    const out = extractDialogue(LEGACY_DUO_SCRIPT);
    expect(out).not.toContain('(主持人)');
    expect(out).not.toContain('(專家)');
    expect(out).toMatch(/Speaker 1:\s*大家好/);
  });

  it('returns empty string when there are no Speaker lines', () => {
    expect(extractDialogue('# AUDIO PROFILE\n## Speaker1: test\n')).toBe('');
  });
});

// --- extractSoloScript -------------------------------------------------

describe('extractSoloScript', () => {
  it('emits "Read the following script..." with the preamble as a Delivery profile block', () => {
    const out = extractSoloScript(NEW_SOLO_SCRIPT);
    expect(out.startsWith('Read the following script naturally.')).toBe(true);
    expect(out).toContain('Delivery profile:');
    expect(out).toContain('# AUDIO PROFILE');
    expect(out).toContain('## Speaker1:');
    expect(out).toContain('\n\nScript:\n');
    // Script: section must only contain clean dialogue lines.
    const afterScript = out.split('\n\nScript:\n')[1];
    expect(afterScript).toBeTruthy();
    expect(afterScript).not.toMatch(/^#/m);
    expect(afterScript).not.toMatch(/^##/m);
    expect(afterScript).not.toMatch(/^Style\s*:/m);
    expect(afterScript).not.toContain('AUDIO PROFILE');
    expect(afterScript).not.toContain('SCENE');
    expect(afterScript).not.toContain('SAMPLE CONTEXT');
    expect(afterScript).not.toContain('書房');
    // Dialogue lines are intact, without the "Speaker 1:" prefix.
    expect(afterScript).toContain('故事要從很久很久以前說起。');
    expect(afterScript).toContain('然後一切都變了。');
    expect(afterScript).not.toMatch(/Speaker\s+1\s*:/);
  });

  it('falls back gracefully when no preamble is present', () => {
    const bare = [
      '投影片 1：標題',
      'Speaker 1: 這是一段測試。',
    ].join('\n');
    const out = extractSoloScript(bare);
    expect(out).toContain('Read the following script naturally.');
    expect(out).not.toContain('Delivery profile:');
    expect(out).toContain('這是一段測試。');
  });

  it('returns empty string when there is no Speaker 1 line', () => {
    expect(extractSoloScript(NEW_DUO_SCRIPT.replace(/Speaker 1:/g, 'Speaker 3:'))).toBe('');
  });
});

// --- splitScriptIntoChunks --------------------------------------------

describe('splitScriptIntoChunks', () => {
  function makeLongDuoScript(slides: number, perLine: number) {
    const lines: string[] = [
      '# AUDIO PROFILE',
      '',
      '## Speaker1: 「主持人」',
      'Style: 熱情活潑。',
      'Accent: 台灣口音。',
      'Pacing: 明快。',
      '',
      '## Speaker2: 「導師」',
      'Style: 溫暖親切。',
      'Accent: 標準華語。',
      'Pacing: 沉穩。',
      '',
      '# SCENE',
      '錄音室。',
      '',
      '# SAMPLE CONTEXT',
      '聊 AI。',
      '',
    ];
    for (let i = 1; i <= slides; i++) {
      lines.push(`投影片 ${i}：主題 ${i}`);
      lines.push('Speaker 1: ' + 'a'.repeat(perLine));
      lines.push('Speaker 2: ' + 'b'.repeat(perLine));
    }
    return lines.join('\n');
  }

  it('re-prepends the full AUDIO PROFILE markdown to every new-format chunk', () => {
    const script = makeLongDuoScript(6, 100);
    // 6 slides × (100 + 100) = 1200 chars → force chunking with maxChars = 300
    const chunks = splitScriptIntoChunks(script, 300);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.startsWith('# AUDIO PROFILE')).toBe(true);
      expect(c).toContain('## Speaker1:');
      expect(c).toContain('## Speaker2:');
      expect(c).toContain('# SCENE');
      expect(c).toContain('# SAMPLE CONTEXT');
    }
  });

  it('re-prepends legacy 風格: to every legacy-format chunk (backward compat)', () => {
    const lines: string[] = ['風格: 輕鬆對談', ''];
    for (let i = 1; i <= 6; i++) {
      lines.push(`投影片 ${i}：主題 ${i}`);
      lines.push('Speaker 1: ' + 'a'.repeat(100));
      lines.push('Speaker 2: ' + 'b'.repeat(100));
    }
    const chunks = splitScriptIntoChunks(lines.join('\n'), 300);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.startsWith('風格:')).toBe(true);
    }
  });

  it('throws CHUNK_TOO_LONG when a single Speaker line exceeds maxChars', () => {
    const script = [
      '# AUDIO PROFILE',
      '',
      '## Speaker1: p',
      'Style: s',
      'Accent: a',
      'Pacing: p',
      '',
      '投影片 1：標題',
      'Speaker 1: ' + 'x'.repeat(500),
    ].join('\n');
    expect(() => splitScriptIntoChunks(script, 100)).toThrow(/CHUNK_TOO_LONG/);
  });

  it('returns a single chunk when total dialogue fits in maxChars', () => {
    const chunks = splitScriptIntoChunks(NEW_DUO_SCRIPT, 10_000);
    expect(chunks.length).toBe(1);
    expect(chunks[0].startsWith('# AUDIO PROFILE')).toBe(true);
  });

  it('does not count preamble chars against the chunk limit', () => {
    // Preamble ~200 chars; per-slide dialogue 80 chars; maxChars 100.
    // If preamble were counted, we would hit the limit on the first slide.
    const script = makeLongDuoScript(3, 40);
    const chunks = splitScriptIntoChunks(script, 100);
    // Each chunk's dialogue part should stay within the limit.
    for (const c of chunks) {
      const dialogueOnly = c
        .split('\n')
        .filter(l => /^Speaker\s+\d+/i.test(l.trim()))
        .map(l => l.replace(/^Speaker\s+\d+\s*:\s*/i, ''))
        .join('');
      expect(dialogueOnly.length).toBeLessThanOrEqual(100);
    }
  });
});

// --- PREAMBLE_LINE_RE --------------------------------------------------

describe('PREAMBLE_LINE_RE', () => {
  const positives = [
    '# AUDIO PROFILE',
    '## Speaker1: 熱血創業者',
    '## Speaker2: 資深導師',
    'Style: 充滿活力',
    'Accent: American',
    'Pacing: 明快',
    '# SCENE',
    '# SAMPLE CONTEXT',
    '風格: 輕鬆',
    '風格：輕鬆',
    '投影片 1：',
    '投影片 12:',
  ];
  const negatives = [
    'Speaker 1: 你好',
    'Speaker 2: 嗨',
    '今天要談 AI',
    'Styles of music',   // no colon, plural
    '風格好的人',         // 風格 without :
    '投影片很漂亮',       // 投影片 without N:
  ];

  for (const line of positives) {
    it(`matches: ${JSON.stringify(line)}`, () => {
      expect(PREAMBLE_LINE_RE.test(line)).toBe(true);
    });
  }
  for (const line of negatives) {
    it(`does NOT match: ${JSON.stringify(line)}`, () => {
      expect(PREAMBLE_LINE_RE.test(line)).toBe(false);
    });
  }
});
