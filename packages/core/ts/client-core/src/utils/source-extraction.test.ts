import { describe, expect, it, mock } from 'bun:test';
import {
  sanitizeUrl,
  sanitizeHttpUrl,
  extractDomain,
  deriveTitleFromLine,
  extractSourcesFromText,
  mergeSources,
  sanitizeRenderableSources,
} from './source-extraction';
import type { SourceReference } from '../types';

describe('sanitizeUrl', () => {
  it('removes trailing punctuation', () => {
    expect(sanitizeUrl('https://example.com.')).toBe('https://example.com');
    expect(sanitizeUrl('https://example.com,')).toBe('https://example.com');
    expect(sanitizeUrl('https://example.com;')).toBe('https://example.com');
    expect(sanitizeUrl('https://example.com!')).toBe('https://example.com');
    expect(sanitizeUrl('https://example.com?')).toBe('https://example.com');
  });

  it('removes trailing punctuation followed by spaces', () => {
    expect(sanitizeUrl('https://example.com). ')).toBe('https://example.com');
  });

  it('returns url unchanged if no trailing punctuation', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
    expect(sanitizeUrl('https://example.com/path')).toBe('https://example.com/path');
  });
});

describe('sanitizeHttpUrl', () => {
  it('allows http and https URLs after punctuation cleanup', () => {
    expect(sanitizeHttpUrl('https://example.com/path).')).toBe('https://example.com/path');
    expect(sanitizeHttpUrl('http://example.com/path')).toBe('http://example.com/path');
  });

  it('rejects unsafe or invalid URLs', () => {
    expect(sanitizeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeHttpUrl('not a url')).toBeNull();
  });
});

describe('extractDomain', () => {
  it('extracts hostname from URL', () => {
    expect(extractDomain('https://example.com/path')).toBe('example.com');
    expect(extractDomain('https://sub.example.com/path')).toBe('sub.example.com');
  });

  it('removes www prefix', () => {
    expect(extractDomain('https://www.example.com')).toBe('example.com');
    expect(extractDomain('https://www.sub.example.com')).toBe('sub.example.com');
  });

  it('returns input on invalid URL', () => {
    expect(extractDomain('not a url')).toBe('not a url');
    expect(extractDomain('')).toBe('');
  });
});

describe('deriveTitleFromLine', () => {
  it('returns text without URL when present', () => {
    const url = 'https://example.com';
    const line = `Check out ${url} for more info`;
    expect(deriveTitleFromLine(line, url)).toBe('Check out  for more info');
  });

  it('returns domain when only URL on line', () => {
    const url = 'https://example.com';
    const line = `- ${url}`;
    expect(deriveTitleFromLine(line, url)).toBe('example.com');
  });

  it('returns domain when line is numbered list with URL', () => {
    const url = 'https://example.com';
    const line = `1. ${url}`;
    expect(deriveTitleFromLine(line, url)).toBe('example.com');
  });

  it('truncates long text to 80 chars', () => {
    const url = 'https://example.com';
    const longText =
      'This is a very long line that exceeds eighty characters and should be truncated appropriately';
    const line = `${longText} ${url}`;
    const result = deriveTitleFromLine(line, url);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns domain when no other text', () => {
    const url = 'https://www.example.com';
    expect(deriveTitleFromLine(url, url)).toBe('example.com');
  });
});

describe('extractSourcesFromText', () => {
  it('returns empty array for null/undefined', () => {
    expect(extractSourcesFromText(null)).toEqual([]);
    expect(extractSourcesFromText(undefined)).toEqual([]);
    expect(extractSourcesFromText('')).toEqual([]);
  });

  it('returns empty array when text has no supported URL markers', () => {
    expect(extractSourcesFromText('Plain streamed response text without citations.')).toEqual([]);
  });

  it('extracts markdown links', () => {
    const text = 'Check out [Example](https://example.com) for more.';
    const result = extractSourcesFromText(text);
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe('https://example.com');
    expect(result[0]?.title).toBe('Example');
  });

  it('extracts plain URLs', () => {
    const text = 'Visit https://example.com today!';
    const result = extractSourcesFromText(text);
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe('https://example.com');
    expect(result[0]?.title).toBeTruthy();
    expect(result[0]?.snippet).toBeTruthy();
  });

  it('deduplicates URLs', () => {
    const text = '[Link](https://example.com) and https://example.com again';
    const result = extractSourcesFromText(text);
    expect(result).toHaveLength(1);
  });

  it('extracts multiple distinct URLs', () => {
    const text = '[First](https://first.com) and [Second](https://second.com)';
    const result = extractSourcesFromText(text);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.url)).toContain('https://first.com');
    expect(result.map((s) => s.url)).toContain('https://second.com');
  });

  it('handles URLs on separate lines', () => {
    const text = `Line 1: https://one.com
Line 2: https://two.com`;
    const result = extractSourcesFromText(text);
    expect(result).toHaveLength(2);
  });

  it('uses domain as title for markdown links without label', () => {
    const text = '[](https://www.example.com)';
    const result = extractSourcesFromText(text);
    expect(result[0]?.url).toBe('https://www.example.com');
  });
});

describe('mergeSources', () => {
  it('returns current when next is empty', () => {
    const current: SourceReference[] = [{ url: 'https://a.com', title: 'A' }];
    expect(mergeSources(current, [])).toEqual(current);
  });

  it('adds new sources from next', () => {
    const current: SourceReference[] = [{ url: 'https://a.com', title: 'A' }];
    const next: SourceReference[] = [{ url: 'https://b.com', title: 'B' }];
    const result = mergeSources(current, next);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.url)).toContain('https://a.com');
    expect(result.map((s) => s.url)).toContain('https://b.com');
  });

  it('merges duplicate URLs keeping first title', () => {
    const current: SourceReference[] = [{ url: 'https://a.com', title: 'Title A' }];
    const next: SourceReference[] = [{ url: 'https://a.com', title: 'Title B' }];
    const result = mergeSources(current, next);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe('Title A');
  });

  it('fills missing title from next', () => {
    const current: SourceReference[] = [{ url: 'https://a.com' }];
    const next: SourceReference[] = [{ url: 'https://a.com', title: 'New Title' }];
    const result = mergeSources(current, next);
    expect(result[0]?.title).toBe('New Title');
  });

  it('fills missing snippet from next', () => {
    const current: SourceReference[] = [{ url: 'https://a.com' }];
    const next: SourceReference[] = [{ url: 'https://a.com', snippet: 'Snippet' }];
    const result = mergeSources(current, next);
    expect(result[0]?.snippet).toBe('Snippet');
  });

  it('preserves snippet from current', () => {
    const current: SourceReference[] = [{ url: 'https://a.com', snippet: 'Current Snippet' }];
    const next: SourceReference[] = [{ url: 'https://a.com', snippet: 'Next Snippet' }];
    const result = mergeSources(current, next);
    expect(result[0]?.snippet).toBe('Current Snippet');
  });
});

describe('sanitizeRenderableSources', () => {
  it('adds safeUrl and drops unsafe URLs once per source key', () => {
    const droppedUrlLog = new Set<string>();
    const warn = mock();
    const sources: SourceReference[] = [
      { url: 'https://example.com/page).', title: 'Example' },
      { url: 'javascript:alert(1)', title: 'Unsafe' },
      { url: 'javascript:alert(1)', title: 'Unsafe' },
    ];

    const first = sanitizeRenderableSources({
      droppedUrlLog,
      logger: { warn },
      loggerContext: 'TestSources',
      sources,
    });
    const second = sanitizeRenderableSources({
      droppedUrlLog,
      logger: { warn },
      loggerContext: 'TestSources',
      sources,
    });

    expect(first).toEqual([
      { url: 'https://example.com/page).', title: 'Example', safeUrl: 'https://example.com/page' },
    ]);
    expect(second).toEqual(first);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Dropped source with unsafe URL in TestSources', {
      url: 'javascript:alert(1)',
      title: 'Unsafe',
    });
  });

  it('respects the optional source limit before sanitizing', () => {
    const sources: SourceReference[] = [
      { url: 'https://one.example' },
      { url: 'https://two.example' },
    ];

    expect(sanitizeRenderableSources({ limit: 1, sources })).toEqual([
      { url: 'https://one.example', safeUrl: 'https://one.example' },
    ]);
  });
});
