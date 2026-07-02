import { describe, expect, it } from 'bun:test';

import type { ToolUsageEvent } from '../types';
import { createToolUsageViewItem, formatCodeLanguageLabel } from './view-model';

const createEvent = (overrides: Partial<ToolUsageEvent>): ToolUsageEvent => ({
  agentLabel: 'Agent',
  toolName: 'search_web',
  arguments: { query: 'docs' },
  success: true,
  durationMs: 1200,
  timestamp: '2026-05-24T00:00:00.000Z',
  ...overrides,
});

describe('tool-usage/view-model', () => {
  it('creates search view data with links, domains, and sources', () => {
    const item = createToolUsageViewItem(
      createEvent({
        resultPreview: JSON.stringify({
          results: [
            {
              url: 'https://docs.example.com/page',
              title: 'Docs',
              snippet: 'Snippet',
            },
          ],
        }),
      }),
      0
    );

    expect(item.title).toBe('Searched for "docs"');
    expect(item.durationLabel).toBe('1.2 s');
    expect(item.searchPreview.domains).toEqual(['docs.example.com']);
    expect(item.searchPreview.links).toEqual([
      { url: 'https://docs.example.com/page', title: 'Docs', snippet: 'Snippet' },
    ]);
    expect(item.searchPreview.sources).toEqual([
      { url: 'https://docs.example.com/page', title: 'Docs', snippet: 'Snippet' },
    ]);
  });

  it('uses explicit search event sources instead of truncated preview data', () => {
    const item = createToolUsageViewItem(
      createEvent({
        resultPreview: JSON.stringify({
          results: [{ url: 'https://partial.example.com/page', title: 'Partial' }],
        }),
        sources: [
          { url: 'https://docs.example.com/page-1', title: 'Docs 1', snippet: 'Snippet 1' },
          { url: 'https://docs.example.com/page-2', title: 'Docs 2', snippet: 'Snippet 2' },
        ],
      }),
      0
    );

    expect(item.searchPreview.totalResults).toBe(2);
    expect(item.searchPreview.links).toEqual([
      { url: 'https://docs.example.com/page-1', title: 'Docs 1', snippet: 'Snippet 1' },
      { url: 'https://docs.example.com/page-2', title: 'Docs 2', snippet: 'Snippet 2' },
    ]);
    expect(item.searchPreview.sources).toEqual([
      { url: 'https://docs.example.com/page-1', title: 'Docs 1', snippet: 'Snippet 1' },
      { url: 'https://docs.example.com/page-2', title: 'Docs 2', snippet: 'Snippet 2' },
    ]);
  });

  it('creates code view data', () => {
    const item = createToolUsageViewItem(
      createEvent({
        toolName: 'execute_code',
        arguments: { code: 'print(1)', language: 'python' },
        resultPreview: JSON.stringify({ output: '1' }),
      }),
      1
    );

    expect(item.title).toBe('Called Run code');
    expect(item.isCode).toBe(true);
    expect(item.codeArgs).toEqual({ code: 'print(1)', language: 'python' });
    expect(item.codePreview).toEqual({ output: '1' });
  });

  it('formats code language labels for UI surfaces', () => {
    expect(formatCodeLanguageLabel()).toBe('Code');
    expect(formatCodeLanguageLabel('python')).toBe('Python code');
    expect(formatCodeLanguageLabel('  typescript  ')).toBe('Typescript code');
  });
});
