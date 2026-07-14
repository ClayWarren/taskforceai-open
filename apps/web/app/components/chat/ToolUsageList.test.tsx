import '@testing-library/jest-dom';
import '../../../../../tests/setup/dom';

import { cleanup, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import ToolUsageList from './ToolUsageList';
import { logger } from '../../lib/logger';
import * as prismModule from '../tool-usage/prism';

vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn() },
}));

describe('ToolUsageList', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const events = [
    {
      timestamp: '2025-01-01T00:00:00Z',
      agentLabel: 'Agent 1',
      agentId: 1,
      toolName: 'search_web',
      arguments: { query: 'hello' },
      success: true,
      durationMs: 450,
      resultPreview: JSON.stringify({
        results: [
          { url: 'https://medium.com/story' },
          { url: 'https://businessinsider.com/article' },
          { url: 'https://fortune.com/a' },
          { url: 'https://gizmodo.com/b' },
          { url: 'https://wired.com/c' },
        ],
      }),
    },
    {
      timestamp: '2025-01-01T00:00:01Z',
      agentLabel: 'Agent 2',
      agentId: 2,
      toolName: 'web-scraper',
      arguments: { url: 'https://example.com' },
      success: false,
      durationMs: 1500,
      error: 'Network error',
    },
    {
      timestamp: '2025-01-01T00:00:02Z',
      agentLabel: 'Agent 3',
      agentId: 3,
      toolName: 'execute_code',
      arguments: { code: 'print(1)', language: 'python', timeout: 5000 },
      success: true,
      durationMs: 10000,
      resultPreview: JSON.stringify({ output: '1', errors: '' }),
    },
    {
      timestamp: '2025-01-01T00:00:03Z',
      agentLabel: 'Agent 4',
      agentId: 4,
      toolName: 'math',
      arguments: { expression: '2+2' },
      success: true,
      durationMs: 25,
    },
  ];

  it('renders tool activity with timing details', async () => {
    const loadPrismSpy = vi.spyOn(prismModule, 'loadPrism').mockResolvedValue(null as any);
    render(<ToolUsageList events={events} />);
    const view = within(document.body);

    expect(view.getByRole('region', { name: 'Tool usage log' })).toBeInTheDocument();
    expect(view.getByText('Agent 1')).toBeVisible();
    expect(view.getByText('Searched for "hello"')).toBeVisible();
    expect(view.getByText('medium.com')).toBeVisible();
    expect(view.getByText('businessinsider.com')).toBeVisible();
    expect(view.getByText('fortune.com')).toBeVisible();
    expect(view.getByText('gizmodo.com')).toBeVisible();
    expect(view.getByText('See all (5)')).toBeVisible();
    expect(view.getByText('Called Web Scraper')).toBeVisible();
    expect(view.getAllByText('Success')).toHaveLength(3);
    expect(view.getByText('Failed')).toBeVisible();
    expect(view.getByText('450 ms')).toBeVisible();
    expect(view.getByText('1.5 s')).toBeVisible();
    expect(view.getByText('10 s')).toBeVisible();
    expect(view.getByText('Network error')).toBeVisible();
    await waitFor(() => {
      expect(loadPrismSpy).toHaveBeenCalled();
    });
  });

  it('renders running tool calls as live activity', () => {
    render(
      <ToolUsageList
        events={[
          {
            timestamp: '2025-01-01T00:00:04Z',
            agentLabel: 'Agent 1',
            agentId: 1,
            toolName: 'search_web',
            arguments: { query: 'latest ai news' },
            status: 'running',
            success: true,
            durationMs: 0,
          },
        ]}
      />
    );
    const view = within(document.body);

    expect(view.getByText('Running')).toBeVisible();
    expect(view.getByText('Running')).toHaveClass('tool-usage__status--running');
  });

  it('renders condensed view with remaining count', async () => {
    const loadPrismSpy = vi.spyOn(prismModule, 'loadPrism').mockResolvedValue(null as any);
    render(<ToolUsageList events={events} condensed />);
    const view = within(document.body);

    expect(view.getAllByRole('listitem')).toHaveLength(3);
    expect(view.getByText('+1 more tool call(s)')).toBeVisible();
    await waitFor(() => {
      expect(loadPrismSpy).toHaveBeenCalled();
    });
  });

  it('returns null when no events provided', () => {
    const { container } = render(<ToolUsageList events={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when events are omitted', () => {
    const { container } = render(<ToolUsageList events={undefined as any} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders non-search previews without timing when optional fields are absent', () => {
    render(
      <ToolUsageList
        events={[
          {
            timestamp: '2025-01-01T00:00:04Z',
            agentLabel: 'Agent 5',
            agentId: 5,
            toolName: 'read_file',
            arguments: { path: '/tmp/report.txt' },
            success: true,
            durationMs: 0,
            resultPreview: 'file contents preview',
          },
        ]}
      />
    );
    const view = within(document.body);

    expect(view.getByText('Called Read file')).toBeVisible();
    expect(view.getByText('file contents preview')).toBeVisible();
    expect(view.queryByText(/ ms$/)).toBeNull();
  });

  it('renders unified diff previews for change-producing tool events', () => {
    render(
      <ToolUsageList
        events={[
          {
            timestamp: '2025-01-01T00:00:06Z',
            agentLabel: 'Agent 7',
            agentId: 7,
            toolName: 'edit_file',
            arguments: { path: 'src/app.ts' },
            success: true,
            durationMs: 60,
            resultPreview: [
              'diff --git a/src/app.ts b/src/app.ts',
              '--- a/src/app.ts',
              '+++ b/src/app.ts',
              '@@ -1,2 +1,3 @@',
              '-const mode = "old";',
              '+const mode = "new";',
              '+start(mode);',
            ].join('\n'),
          },
        ]}
      />
    );
    const view = within(document.body);

    expect(view.getByText('1 changed file')).toBeVisible();
    expect(view.getByText('src/app.ts')).toBeVisible();
    expect(view.getAllByText('+2')).toHaveLength(2);
    expect(view.getAllByText('-1')).toHaveLength(2);
    expect(view.getByText('+const mode = "new";')).toBeVisible();
  });

  it('uses unknown query fallback and ignores malformed search previews', () => {
    render(
      <ToolUsageList
        events={[
          {
            timestamp: '2025-01-01T00:00:05Z',
            agentLabel: 'Agent 6',
            agentId: 6,
            toolName: 'search_web',
            arguments: {},
            success: true,
            durationMs: 0,
            resultPreview: '{bad-json',
          },
        ]}
      />
    );
    const view = within(document.body);

    expect(view.getByText('Searched for "unknown query"')).toBeVisible();
    expect(view.queryByRole('link')).toBeNull();
    expect(view.queryByRole('button', { name: /see all/i })).toBeNull();
  });

  it('links search results and triggers see all when interactive', async () => {
    const user = userEvent.setup();
    const handleShowSources = vi.fn();
    render(<ToolUsageList events={events} searchInteractive onShowSources={handleShowSources} />);
    const view = within(document.body);

    const mediumLink = view.getByRole('link', { name: 'medium.com' });
    expect(mediumLink).toHaveAttribute('href', 'https://medium.com/story');

    const seeAllButton = view.getByRole('button', { name: /see all/i });
    await user.click(seeAllButton);
    expect(handleShowSources).toHaveBeenCalledTimes(1);
    expect(handleShowSources.mock.calls[0]?.[0][0]).toMatchObject({
      url: 'https://medium.com/story',
    });
  });

  it('expands code execution events for detailed output', async () => {
    const user = userEvent.setup();
    render(<ToolUsageList events={events} />);
    const view = within(document.body);

    const toggle = view.getByRole('button', { name: /expand/i });
    await user.click(toggle);

    expect(view.getByText('Python code')).toBeVisible();
    const codeBlock = view.getByText('Python code').closest('.tool-usage__code-block');
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.textContent).toContain('print(1)');
    const outputHeading = view.getByText('Output');
    expect(outputHeading).toBeVisible();
    const outputPre = outputHeading.nextElementSibling;
    expect(outputPre?.textContent).toBe('1');

    await user.click(view.getByRole('button', { name: /collapse/i }));
    expect(view.queryByText('Python code')).toBeNull();
  });

  it('highlights code after Prism loads', async () => {
    const user = userEvent.setup();
    vi.spyOn(prismModule, 'loadPrism').mockResolvedValue({
      languages: { python: {} },
      highlight: vi.fn(() => '<span class="token">print</span>'),
    } as any);

    render(<ToolUsageList events={events} />);
    const view = within(document.body);

    await waitFor(() => {
      expect(prismModule.loadPrism).toHaveBeenCalled();
    });
    await user.click(view.getByRole('button', { name: /expand/i }));

    const codeBlock = view.getByText('Python code').closest('.tool-usage__code-block');
    expect(codeBlock?.innerHTML).toContain('token');
  });

  it('shows a loading indicator while Prism is loading', async () => {
    const user = userEvent.setup();
    const prismPromise = new Promise<typeof import('../tool-usage/prism')>(() => {});
    vi.spyOn(prismModule, 'loadPrism').mockReturnValue(prismPromise as any);

    render(<ToolUsageList events={events} />);
    const view = within(document.body);
    await user.click(view.getByRole('button', { name: /expand/i }));

    expect(view.getByRole('status')).toHaveTextContent('Loading syntax highlighting...');
  });

  it('logs Prism loading failures with safe diagnostics', async () => {
    vi.spyOn(prismModule, 'loadPrism').mockRejectedValue(new Error('Chunk failed'));

    render(<ToolUsageList events={events} />);

    await waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('Failed to load Prism syntax highlighting', {
        error: expect.any(Error),
      });
    });
  });

  it('correctly applies CSS classes for search events (Hardening TF-0265)', () => {
    const searchEvent = [events[0]!];
    const { container } = render(<ToolUsageList events={searchEvent} />);

    // The summary div should have both classes separated by a space
    const summaryDiv = container.querySelector('.tool-usage__summary');
    expect(summaryDiv).not.toBeNull();
    expect(summaryDiv?.className).toContain('tool-usage__summary');
    expect(summaryDiv?.className).toContain('tool-usage__summary--search');

    // Crucially, it should NOT be concatenated without a space
    expect(summaryDiv?.className).not.toContain('tool-usage__summarytool-usage__summary--search');
  });
});
