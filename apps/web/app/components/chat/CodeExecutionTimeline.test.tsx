import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import type { Message, ToolUsageEvent } from '../../lib/types';

const useStreamingMock = vi.fn();

vi.mock('../../lib/providers/StreamingProvider', () => ({
  useStreaming: useStreamingMock,
}));

vi.mock('./ApprovalCard', () => ({
  ApprovalCard: ({ taskId }: { taskId: string }) => <div data-testid="approval-card">{taskId}</div>,
}));

import { CodeExecutionTimeline, summarizeCodeToolEvents } from './CodeExecutionTimeline';

const event = (toolName: string, overrides: Partial<ToolUsageEvent> = {}): ToolUsageEvent => ({
  agentId: 0,
  agentLabel: 'Code agent',
  toolName,
  arguments: {},
  success: true,
  durationMs: 12,
  ...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 'task-code-1',
  role: 'assistant',
  content: 'Done',
  ...overrides,
});

describe('CodeExecutionTimeline', () => {
  beforeEach(() => {
    useStreamingMock.mockReturnValue({
      agentStatuses: [],
      isStreaming: false,
      toolEvents: [],
      finalToolEvents: [],
      pendingApproval: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('summarizes execution activity without a progress bubble and expands real results', () => {
    const events = [
      event('apply_patch', {
        resultPreview:
          'diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new',
      }),
      event('read_file'),
      event('exec_command', { resultPreview: 'bun test passed' }),
    ];

    render(<CodeExecutionTimeline message={message({ elapsedSeconds: 39, toolEvents: events })} />);

    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Worked for 39s')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Edited 1 file, read 1 file, ran 1 command/i })
    ).toBeTruthy();
    expect(screen.queryByText('bun test passed')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: /Edited 1 file, read 1 file, ran 1 command/i })
    );

    expect(screen.getByText('Edited files')).toBeTruthy();
    expect(screen.getByText('Read files')).toBeTruthy();
    expect(screen.getByText('Ran a command')).toBeTruthy();
    expect(screen.getByText('bun test passed')).toBeTruthy();
    expect(screen.getByText('1 changed file')).toBeTruthy();
  });

  it('uses live status as an inline row when no tools have run yet', () => {
    useStreamingMock.mockReturnValue({
      agentStatuses: [{ status: 'PROCESSING', reasoning: 'Planning the implementation' }],
      isStreaming: true,
      toolEvents: [],
      finalToolEvents: [],
      pendingApproval: null,
    });

    render(<CodeExecutionTimeline message={message({ isAgentStatus: true })} />);

    expect(screen.getByText('Working')).toBeTruthy();
    expect(screen.getByText('Planning the implementation')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('builds a compact fallback summary for uncategorized tools', () => {
    expect(summarizeCodeToolEvents([event('custom_tool')])).toBe('Used 1 tool');
  });

  it('covers empty and plural execution summaries', () => {
    expect(summarizeCodeToolEvents([])).toBe('Working');
    expect(
      summarizeCodeToolEvents([
        event('write_file'),
        event('rename_file'),
        event('search_files'),
        event('list_files'),
        event('shell_command'),
        event('run_tests'),
        event('custom_tool'),
        event('another_tool'),
      ])
    ).toBe('Edited 2 files, read 2 files, ran 2 commands, used 2 tools');
  });

  it('renders result states, previews, errors, durations, and source actions', () => {
    const onShowSources = vi.fn();
    const sources = [
      { url: 'https://example.com/one', title: 'One' },
      { url: 'https://example.com/two', title: 'Two' },
    ];
    const events = [
      event('custom_tool', {
        success: false,
        error: 'Tool failed',
        resultPreview: 'Failure details',
        sources,
      }),
      event('shell_command', {
        success: false,
        status: 'running',
        resultPreview: 'Command is still running',
        sources: [sources[0]!],
      }),
      event('rename_file'),
    ];

    render(
      <CodeExecutionTimeline
        message={message({ elapsedSeconds: 61, toolEvents: events })}
        onShowSources={onShowSources}
      />
    );

    expect(screen.getByText('Worked for 1m 01s')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Edited 1 file, ran 1 command/i }));

    expect(screen.getByText('Called Custom Tool')).toBeTruthy();
    expect(screen.getByText('Tool failed')).toBeTruthy();
    expect(screen.getByText('Failure details')).toBeTruthy();
    expect(screen.getByText('Command is still running')).toBeTruthy();
    expect(screen.getByLabelText('Failed')).toBeTruthy();
    expect(screen.getByLabelText('Running')).toBeTruthy();
    expect(screen.getByText('2 sources')).toBeTruthy();
    expect(screen.getByText('1 source')).toBeTruthy();

    fireEvent.click(screen.getByText('2 sources'));
    expect(onShowSources).toHaveBeenCalledWith(sources);
  });

  it('renders stored status and approval fallbacks with a normalized task id', () => {
    render(
      <CodeExecutionTimeline
        message={message({
          id: 'local-approval',
          agentStatuses: [{ status: 'WAITING_FOR_APPROVAL' }],
          pendingApproval: {
            approvalId: 'approval-1',
            permission: 'Run command',
            agentName: 'Code agent',
            patterns: [],
            metadata: {},
          },
        })}
      />
    );

    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.getByTestId('approval-card')).toHaveTextContent('task_local-approval');
  });

  it('uses result text for stored status and preserves existing task ids', () => {
    render(
      <CodeExecutionTimeline
        message={message({
          id: 'task_existing',
          agentStatuses: [{ status: 'COMPLETED', result: ' Finished successfully ' }],
          pendingApproval: {
            permission: 'Read file',
            agentName: 'Code agent',
            patterns: ['README.md'],
            metadata: {},
          },
        })}
      />
    );

    expect(screen.getByText('Finished successfully')).toBeTruthy();
    expect(screen.getByTestId('approval-card')).toHaveTextContent('task_existing');
  });

  it('updates and cleans up the live elapsed timer', () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    useStreamingMock.mockReturnValue({
      agentStatuses: [{ status: 'RUNNING' }],
      isStreaming: true,
      toolEvents: [],
      finalToolEvents: [],
      pendingApproval: null,
    });

    const { unmount } = render(
      <CodeExecutionTimeline message={message({ isStreaming: true, elapsedSeconds: undefined })} />
    );

    expect(screen.getByText('Working')).toBeTruthy();
    act(() => {
      now = 61_000;
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByText('Working for 1m 01s')).toBeTruthy();

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('renders nothing without execution activity', () => {
    const { container } = render(<CodeExecutionTimeline message={message()} />);

    expect(container.firstChild).toBeNull();
  });
});
