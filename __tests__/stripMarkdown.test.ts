import { describe, it, expect } from 'vitest';
import { stripMarkdown } from '@/lib/stripMarkdown';

describe('stripMarkdown: generic behavior', () => {
  it('strips ordinary markdown headings', () => {
    expect(stripMarkdown('# Title\n## Subtitle\n### Inner')).toBe(
      'Title\nSubtitle\nInner',
    );
  });

  it('strips bold / italic / inline code / links', () => {
    expect(stripMarkdown('**bold** _em_ `code` [x](https://a)')).toBe(
      'bold em code x',
    );
  });

  it('collapses triple-newlines to double', () => {
    expect(stripMarkdown('a\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('stripMarkdown: AUDIO PROFILE preservation', () => {
  it('keeps # AUDIO PROFILE heading intact', () => {
    const out = stripMarkdown('# AUDIO PROFILE\n\n## Speaker1: foo');
    expect(out).toContain('# AUDIO PROFILE');
    expect(out).toContain('## Speaker1:');
  });

  it('keeps ## Speaker1: / ## Speaker2: intact', () => {
    const out = stripMarkdown(
      [
        '# AUDIO PROFILE',
        '',
        '## Speaker1: 「熱血主持」',
        'Style: 活潑',
        '',
        '## Speaker2: 「沉穩導師」',
        'Style: 溫暖',
      ].join('\n'),
    );
    expect(out).toMatch(/^# AUDIO PROFILE$/m);
    expect(out).toMatch(/^## Speaker1: /m);
    expect(out).toMatch(/^## Speaker2: /m);
  });

  it('keeps # SCENE and # SAMPLE CONTEXT intact', () => {
    const out = stripMarkdown('# SCENE\n錄音室\n\n# SAMPLE CONTEXT\n情境');
    expect(out).toContain('# SCENE');
    expect(out).toContain('# SAMPLE CONTEXT');
  });

  it('still strips unrelated # headings in the same document', () => {
    const out = stripMarkdown(
      [
        '# AUDIO PROFILE',
        '## Speaker1: foo',
        '',
        '# Random Heading',
        '## Another Heading',
      ].join('\n'),
    );
    expect(out).toContain('# AUDIO PROFILE');
    expect(out).toContain('## Speaker1:');
    expect(out).not.toContain('# Random Heading');
    expect(out).not.toContain('## Another Heading');
    expect(out).toContain('Random Heading');
    expect(out).toContain('Another Heading');
  });

  it('does not confuse ## SpeakerX (X != 1|2) with the preamble format', () => {
    const out = stripMarkdown('## Speaker3: 假的\n## Speaker 1: 也是假的');
    // Both should be treated as plain markdown headings and stripped.
    expect(out).not.toContain('## Speaker3:');
    expect(out).not.toContain('## Speaker 1:');
    expect(out).toContain('Speaker3:');
  });
});
