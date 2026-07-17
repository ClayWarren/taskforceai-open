import { describe, expect, test, vi } from 'bun:test';
import '../../../../../tests/setup/dom';

import { formatLanguageLabel, highlightCode, loadPrism, sanitizePrismHtml } from './prism';

describe('prism utils', () => {
  describe('formatLanguageLabel', () => {
    test('formats python', () => {
      expect(formatLanguageLabel('python')).toBe('Python code');
    });

    test('formats javascript', () => {
      expect(formatLanguageLabel('javascript')).toBe('Javascript code');
    });

    test('formats unknown/other languages', () => {
      expect(formatLanguageLabel('ruby')).toBe('Ruby code');
    });

    test('handles empty or undefined', () => {
      expect(formatLanguageLabel(undefined)).toBe('Code');
      expect(formatLanguageLabel('')).toBe('Code');
      expect(formatLanguageLabel('   ')).toBe('Code');
    });
  });

  describe('highlightCode', () => {
    type PrismLike = NonNullable<Parameters<typeof highlightCode>[1]>;
    const mockPrism: PrismLike = {
      languages: {
        python: {},
        javascript: {},
        typescript: {},
        bash: {},
        json: {},
        go: {},
        rust: {},
        yaml: {},
      },
      highlight: vi.fn(
        (code: string, _grammar: unknown, _lang: string) => `<highlighted>${code}</highlighted>`
      ),
    };

    test('returns plain text if no code', () => {
      const result = highlightCode({ code: '', language: 'python' }, mockPrism);
      expect(result.html).toBeNull();
      expect(result.languageClass).toBe('language-none');
    });

    test('returns plain text if prism not loaded', () => {
      const result = highlightCode({ code: 'print("hi")', language: 'python' }, null);
      expect(result.html).toBeNull();
      expect(result.languageClass).toBe('language-python');
    });

    test('highlights python code', () => {
      const result = highlightCode({ code: 'print("hi")', language: 'python' }, mockPrism);
      expect(result.html).toBe('<highlighted>print("hi")</highlighted>');
      expect(result.languageClass).toBe('language-python');
      expect(mockPrism.highlight).toHaveBeenCalledWith('print("hi")', expect.anything(), 'python');
    });

    test('highlights additional supported languages', () => {
      for (const language of ['json', 'bash', 'go', 'rust', 'yaml'] as const) {
        const result = highlightCode({ code: 'sample', language }, mockPrism);
        expect(result.languageClass).toBe(`language-${language}`);
        expect(result.html).toBe('<highlighted>sample</highlighted>');
      }
    });

    test('normalizes js to javascript', () => {
      const result = highlightCode({ code: 'console.log("hi")', language: 'js' }, mockPrism);
      expect(result.languageClass).toBe('language-javascript');
      expect(mockPrism.highlight).toHaveBeenCalledWith(
        'console.log("hi")',
        expect.anything(),
        'javascript'
      );
    });

    test('normalizes ts to typescript', () => {
      const result = highlightCode({ code: 'const x: number = 1', language: 'ts' }, mockPrism);
      expect(result.languageClass).toBe('language-typescript');
      expect(mockPrism.highlight).toHaveBeenCalledWith(
        'const x: number = 1',
        expect.anything(),
        'typescript'
      );
    });

    test('returns language-none for unsupported languages', () => {
      const result = highlightCode({ code: 'puts "hi"', language: 'ruby' }, mockPrism);
      expect(result.languageClass).toBe('language-none');
      expect(result.html).toBeNull();
    });

    test('normalizes shell, node, and systems language aliases', () => {
      const cases = [
        ['bash', 'language-bash'],
        ['sh', 'language-bash'],
        ['shell', 'language-bash'],
        ['nodejs', 'language-javascript'],
        ['py', 'language-python'],
        ['golang', 'language-go'],
        ['rs', 'language-rust'],
        ['yml', 'language-yaml'],
      ] as const;

      for (const [language, languageClass] of cases) {
        const result = highlightCode({ code: 'sample', language }, mockPrism);
        expect(result.languageClass).toBe(languageClass);
      }
    });

    test('returns null html when the grammar is unavailable', () => {
      const prismWithoutGo: PrismLike = {
        languages: { python: {} },
        highlight: mockPrism.highlight,
      };

      const result = highlightCode({ code: 'package main', language: 'go' }, prismWithoutGo);

      expect(result.languageClass).toBe('language-go');
      expect(result.html).toBeNull();
    });
  });

  describe('sanitizePrismHtml', () => {
    test('strips markup when DOM parsing is unavailable', () => {
      const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
      const parserDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
      Object.defineProperty(globalThis, 'document', { configurable: true, value: undefined });
      Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: undefined });
      try {
        expect(sanitizePrismHtml('<span>safe</span><script>bad()</script>')).toBe('safebad()');
      } finally {
        if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
        if (parserDescriptor) Object.defineProperty(globalThis, 'DOMParser', parserDescriptor);
      }
    });

    test('preserves legitimate Prism token spans', () => {
      const html =
        '<span class="token keyword">const</span> <span class="token function">run</span>';

      expect(sanitizePrismHtml(html)).toBe(html);
    });

    test('removes unsafe elements, attributes, and class names', () => {
      const html =
        '<span class="token keyword invalid/class" onclick="evil()">const</span>' +
        '<img src="x" onerror="evil()">';

      const sanitized = sanitizePrismHtml(html);

      expect(sanitized).toBe('<span class="token keyword">const</span>');
      expect(sanitized).not.toContain('onclick');
      expect(sanitized).not.toContain('onerror');
      expect(sanitized).not.toContain('<img');
      expect(sanitized).not.toContain('invalid/class');
    });
  });

  describe('loadPrism', () => {
    test('loads prism asynchronously', async () => {
      const prism = await loadPrism();
      expect(prism).toBeDefined();
      expect(prism.highlight).toBeDefined();
    });

    test('returns cached instance on second call', async () => {
      const first = await loadPrism();
      const second = await loadPrism();
      expect(first).toBe(second);
    });
  });
});
