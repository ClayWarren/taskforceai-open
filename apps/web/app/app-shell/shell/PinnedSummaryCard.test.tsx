import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import { WorkPinnedSummary } from './PinnedSummaryCard';
import { collectPinnedSummaryData } from './pinned-summary-data';

describe('WorkPinnedSummary', () => {
  afterEach(() => cleanup());

  it('collects unique outputs and sources from persisted message metadata', () => {
    const data = collectPinnedSummaryData([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Done',
        sources: [{ url: 'https://openai.com/news', title: 'News' }],
        toolEvents: [
          {
            agentLabel: 'Agent',
            toolName: 'document',
            arguments: {},
            success: true,
            durationMs: 1,
            generatedFile: { filename: 'brief.pdf', fileId: 'file-1' },
          },
          {
            agentLabel: 'Agent',
            toolName: 'document',
            arguments: {},
            success: true,
            durationMs: 1,
            generatedFile: { filename: 'brief.pdf', fileId: 'file-1' },
          },
        ],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: 'More',
        toolEvents: [
          {
            agentLabel: 'Researcher',
            toolName: 'search_web',
            arguments: {},
            success: true,
            durationMs: 1,
            sources: [{ url: 'https://anthropic.com/research' }],
          },
        ],
      },
    ]);

    expect(data.files.map((file) => file.filename)).toEqual(['brief.pdf']);
    expect(data.sources.map((source) => source.url)).toEqual([
      'https://openai.com/news',
      'https://anthropic.com/research',
    ]);
  });

  it('offers output creation until a generated file exists', () => {
    const onCreateOutput = vi.fn();
    const emptyOutputData = collectPinnedSummaryData([
      { id: 'user-1', role: 'user', content: 'Research this' },
    ]);
    const { rerender } = render(
      <WorkPinnedSummary data={emptyOutputData} onCreateOutput={onCreateOutput} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create a file or site' }));
    expect(onCreateOutput).toHaveBeenCalledTimes(1);

    rerender(
      <WorkPinnedSummary
        data={collectPinnedSummaryData([
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Done',
            toolEvents: [
              {
                agentLabel: 'Agent',
                toolName: 'document',
                arguments: {},
                success: true,
                durationMs: 1,
                generatedFile: { filename: 'report.docx', artifactId: 'artifact-1' },
              },
            ],
          },
        ])}
        onCreateOutput={onCreateOutput}
      />
    );

    expect(screen.queryByRole('button', { name: 'Create a file or site' })).toBeNull();
    expect(screen.getByRole('link', { name: 'report.docx' }).getAttribute('href')).toBe(
      '/artifacts/artifact-1'
    );
  });

  it('expands long source lists and renders unsafe sources without links', () => {
    const sources = [
      { url: 'https://one.example/a' },
      { url: 'https://two.example/a' },
      { url: 'https://three.example/a' },
      { url: 'https://four.example/a' },
      { url: 'https://five.example/a' },
      { url: 'javascript:alert(1)', title: 'Unsafe source' },
    ];
    render(<WorkPinnedSummary data={{ files: [], sources }} onCreateOutput={vi.fn()} />);

    expect(screen.queryByText('Unsafe source')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View all' }));
    const showLess = screen.getByRole('button', { name: 'Show less' });
    expect(showLess.parentElement?.children[5]?.tagName).toBe('DIV');
    fireEvent.click(showLess);
    expect(screen.getByRole('button', { name: 'View all' }).parentElement?.children).toHaveLength(
      6
    );
  });
});
