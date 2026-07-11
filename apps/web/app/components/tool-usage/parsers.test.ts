import { describe, expect, it } from 'bun:test';

import type { ToolUsageEvent } from '../../lib/types';
import {
  extractCodeExecutionArgs,
  extractSearchArgs,
  isCodeExecutionEvent,
  isSearchEvent,
  parseCodeExecutionPreview,
  parseSearchPreview,
} from './parsers';

const createToolEvent = (overrides: Partial<ToolUsageEvent>): ToolUsageEvent => ({
  agentLabel: 'Agent',
  arguments: {},
  durationMs: 10,
  success: true,
  toolName: 'unknown',
  ...overrides,
});

describe('tool usage parsers', () => {
  it('detects code execution and search events by normalized tool name', () => {
    expect(isCodeExecutionEvent(createToolEvent({ toolName: ' Execute_Code ' }))).toBe(true);
    expect(isCodeExecutionEvent(createToolEvent({ toolName: 'search_web' }))).toBe(false);

    expect(isSearchEvent(createToolEvent({ toolName: ' SEARCH_WEB ' }))).toBe(true);
    expect(isSearchEvent(createToolEvent({ toolName: 'execute_code' }))).toBe(false);
  });

  it('extracts code execution arguments from event arguments', () => {
    const args = extractCodeExecutionArgs(
      createToolEvent({
        arguments: JSON.stringify({
          code: 'print("ok")',
          language: 'python',
          timeout: 5_000,
        }),
      })
    );

    expect(args).toEqual({
      code: 'print("ok")',
      language: 'python',
      timeout: 5_000,
    });
  });

  it('returns empty code execution arguments for invalid event arguments', () => {
    const args = extractCodeExecutionArgs(createToolEvent({ arguments: '{not json' }));

    expect(args).toEqual({});
  });

  it('extracts search arguments from event arguments', () => {
    const args = extractSearchArgs(
      createToolEvent({
        arguments: {
          query: 'taskforce ai docs',
        },
      })
    );

    expect(args).toEqual({ query: 'taskforce ai docs' });
  });

  it('parses code execution previews through the shared parser', () => {
    const preview = parseCodeExecutionPreview(
      JSON.stringify({
        output: 'done',
        errors: 'warning',
      })
    );

    expect(preview).toEqual({
      output: 'done',
      errors: 'warning',
    });
  });

  it('normalizes search preview results into links and unique domains', () => {
    const preview = parseSearchPreview(
      JSON.stringify({
        totalResults: 7,
        results: [
          {
            url: 'https://docs.example.com/a',
            title: 'Docs A',
            snippet: 'Alpha',
          },
          {
            url: 'https://docs.example.com/b',
            title: 'Docs B',
          },
          {
            url: 'https://blog.example.net/post',
            snippet: 'Beta',
          },
          {
            url: '   ',
            title: 'Blank URL',
            snippet: 'Should be skipped',
          },
        ],
      })
    );

    expect(preview).toEqual({
      domains: ['docs.example.com', 'blog.example.net'],
      links: [
        {
          url: 'https://docs.example.com/a',
          title: 'Docs A',
          snippet: 'Alpha',
        },
        {
          url: 'https://docs.example.com/b',
          title: 'Docs B',
        },
        {
          url: 'https://blog.example.net/post',
          snippet: 'Beta',
        },
      ],
      totalResults: 7,
    });
  });

  it('supports link-shaped search previews and falls back to parsed result count', () => {
    const preview = parseSearchPreview(
      JSON.stringify({
        links: [
          {
            url: 'https://www.taskforce.ai/platform',
            title: 'Platform',
          },
        ],
      })
    );

    expect(preview).toEqual({
      domains: ['taskforce.ai'],
      links: [
        {
          url: 'https://www.taskforce.ai/platform',
          title: 'Platform',
        },
      ],
      totalResults: 1,
    });
  });

  it('returns an empty search preview for invalid preview payloads', () => {
    const preview = parseSearchPreview('not-json');

    expect(preview).toEqual({
      domains: [],
      links: [],
      totalResults: 0,
    });
  });
});
