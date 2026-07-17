import { describe, expect, it } from 'bun:test';
import { containsLatexMath, splitMarkdownAndLatex } from './math';

describe('math utils', () => {
  it('detects block and inline latex delimiters', () => {
    expect(containsLatexMath('Energy: \\(E = mc^2\\)')).toBe(true);
    expect(containsLatexMath('$$a^2 + b^2 = c^2$$')).toBe(true);
    expect(containsLatexMath('\\[x + y = z\\]')).toBe(true);
  });

  it('returns no segments for empty content', () => {
    expect(splitMarkdownAndLatex('')).toEqual([]);
    expect(containsLatexMath('')).toBe(false);
  });

  it('ignores latex-looking content inside code spans and fences', () => {
    expect(containsLatexMath('Use `\\(not math\\)` in code')).toBe(false);
    expect(containsLatexMath('```tex\n$$not math$$\n```')).toBe(false);
  });

  it('treats unclosed code and math delimiters as markdown', () => {
    expect(splitMarkdownAndLatex('Use `unterminated \\(x\\)')).toEqual([
      { type: 'markdown', raw: 'Use `unterminated \\(x\\)' },
    ]);
    expect(splitMarkdownAndLatex('```tex\n$$unterminated')).toEqual([
      { type: 'markdown', raw: '```tex\n$$unterminated' },
    ]);
    expect(splitMarkdownAndLatex('Before \\(unterminated')).toEqual([
      { type: 'markdown', raw: 'Before \\(unterminated' },
    ]);
  });

  it('splits markdown and latex segments without dropping surrounding text', () => {
    expect(splitMarkdownAndLatex('Before \\(x\\) after')).toEqual([
      { type: 'markdown', raw: 'Before ' },
      { type: 'inline-math', raw: '\\(x\\)', expression: 'x' },
      { type: 'markdown', raw: ' after' },
    ]);
  });

  it('splits block latex delimiters', () => {
    expect(splitMarkdownAndLatex('A\n$$x+y$$\nB')).toEqual([
      { type: 'markdown', raw: 'A\n' },
      { type: 'block-math', raw: '$$x+y$$', expression: 'x+y' },
      { type: 'markdown', raw: '\nB' },
    ]);
  });

  it('splits bracket block delimiters at the beginning without empty markdown segments', () => {
    expect(splitMarkdownAndLatex('\\[x+y\\] tail')).toEqual([
      { type: 'block-math', raw: '\\[x+y\\]', expression: 'x+y' },
      { type: 'markdown', raw: ' tail' },
    ]);
  });

  it('resumes latex parsing after closed code spans and fences', () => {
    expect(splitMarkdownAndLatex('Use `literal \\(x\\)` then \\(y\\)')).toEqual([
      { type: 'markdown', raw: 'Use `literal \\(x\\)` then ' },
      { type: 'inline-math', raw: '\\(y\\)', expression: 'y' },
    ]);

    expect(splitMarkdownAndLatex('```tex\n$$literal$$\n```\n$$real$$')).toEqual([
      { type: 'markdown', raw: '```tex\n$$literal$$\n```\n' },
      { type: 'block-math', raw: '$$real$$', expression: 'real' },
    ]);
  });
});
