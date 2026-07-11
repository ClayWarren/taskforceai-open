import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'bun:test';
import React from 'react';

let renderMarkdownImpl = (content: string) => `<pre><code>${content}</code></pre>`;
const renderMarkdownCalls: string[] = [];
const loggerWarnings: Array<{ message: string; meta: unknown }> = [];

vi.mock('@/lib/safe-markdown', () => ({
  renderMarkdownToSafeHtml: (content: string) => {
    renderMarkdownCalls.push(content);
    return renderMarkdownImpl(content);
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (message: string, meta: unknown) => {
      loggerWarnings.push({ message, meta });
    },
  },
}));

let ChunkedMarkdown: React.ComponentType<{ content: string }>;

beforeAll(async () => {
  ({ default: ChunkedMarkdown } = await import('./ChunkedMarkdown'));
});

afterEach(() => {
  renderMarkdownImpl = (content: string) => `<pre><code>${content}</code></pre>`;
  renderMarkdownCalls.length = 0;
  loggerWarnings.length = 0;
});

describe('ChunkedMarkdown', () => {
  it('renders sanitized markdown', async () => {
    render(<ChunkedMarkdown content="const answer = 42;" />);

    expect(renderMarkdownCalls).toEqual(['const answer = 42;']);
    expect(screen.getByText('const answer = 42;')).toBeTruthy();
  });

  it('logs and renders an empty container when markdown rendering fails', () => {
    renderMarkdownImpl = () => {
      throw new Error('boom');
    };

    const { container } = render(<ChunkedMarkdown content="broken" />);

    expect(container.querySelector('.markdown-content')?.innerHTML).toBe('');
    expect(loggerWarnings[0]?.message).toBe('Failed to render markdown content');
  });
});
