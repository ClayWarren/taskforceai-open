import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../tests/setup/dom';

const useStreamingMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerDebugMock = vi.fn();

vi.mock('../../lib/providers/StreamingProvider', () => ({
  useStreaming: useStreamingMock,
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: loggerWarnMock,
    debug: loggerDebugMock,
  },
}));

vi.mock('./ApprovalCard', () => ({
  ApprovalCard: ({ taskId, approval, onDecision }: any) => (
    <div data-testid="approval-card">
      <span>{taskId}</span>
      <span>{approval?.description}</span>
      <button onClick={() => onDecision?.(true)}>Approve</button>
    </div>
  ),
}));

vi.mock('./ExecutionReplay', () => ({
  ExecutionReplay: ({ taskId, onFrameUpdate }: any) => (
    <button
      data-testid="execution-replay"
      onClick={() =>
        onFrameUpdate({
          agentStatuses: [{ status: 'COMPLETED', agent_id: 2 }],
          toolEvents: [
            {
              agentId: 2,
              agentLabel: 'Replay',
              toolName: 'lookup',
              arguments: {},
              success: true,
              durationMs: 1,
            },
          ],
          reasoning: `replay ${taskId}`,
          isComplete: true,
        })
      }
    >
      Replay {taskId}
    </button>
  ),
}));

vi.mock('./ComputerTheater', () => ({
  ComputerTheater: (props: any) => (
    <div data-testid="computer-theater">{props.agentLabel ?? 'no-agent-label'}</div>
  ),
}));

import AgentExecutionPanel from './AgentExecutionPanel';

const expectToolUsage = (label: string) => {
  if (screen.queryByText(label)) {
    return;
  }
  expect(screen.getByTestId('tool-usage-list')).toBeDefined();
};

const createMessage = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'm1',
    role: 'assistant',
    content: 'result',
    isStreaming: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }) as any;

const setStreamingState = (overrides: Record<string, unknown> = {}) => {
  useStreamingMock.mockReturnValue({
    agentStatuses: [],
    isStreaming: false,
    toolEvents: [],
    finalToolEvents: [],
    modelBadge: 'HEAVY',
    reasoning: undefined,
    finalReasoning: undefined,
    pendingApproval: null,
    computerUseEnabled: false,
    ...overrides,
  });
};

describe('AgentExecutionPanel', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders completed compact state from stored agent snapshot', () => {
    setStreamingState({
      isStreaming: false,
      modelBadge: null,
    });

    render(
      <AgentExecutionPanel
        message={createMessage({
          elapsedSeconds: 125,
          agentStatuses: [{ status: 'COMPLETED', agent_id: 0 }],
        })}
      />
    );

    expect(screen.getByText('Completed')).toBeDefined();
    expect(screen.getByText('HEAVY')).toBeDefined();
    expect(screen.getByText('2m 05s')).toBeDefined();
    expect(document.querySelector('.agent-execution-dot--completed')).toBeTruthy();
  });

  it('defaults unknown statuses to 40%', () => {
    setStreamingState({
      isStreaming: true,
      agentStatuses: [{ status: 'Unexpected state value' }],
    });

    render(<AgentExecutionPanel message={createMessage()} />);

    // Auto-expand fires when streaming; collapse to access compact view
    fireEvent.click(screen.getByText('Collapse'));

    expect(screen.getByRole('progressbar', { name: 'Overall agent progress' })).toHaveAttribute(
      'aria-valuenow',
      '40'
    );
  });

  it('derives failed indicator when any running agent fails', () => {
    setStreamingState({
      isStreaming: true,
      agentStatuses: [
        { status: 'FAILED: timeout', agent_id: 0 },
        { status: 'PROGRESS:0.2', agent_id: 1 },
      ],
    });

    render(<AgentExecutionPanel message={createMessage()} />);

    // Auto-expand fires when streaming; collapse to access compact view
    fireEvent.click(screen.getByText('Collapse'));

    expect(screen.getByText('Agents Working')).toBeDefined();
    expect(document.querySelector('.agent-execution-dot--failed')).toBeTruthy();
  });

  it('expands and passes stored tool events and reasoning when stream is complete', () => {
    setStreamingState({
      isStreaming: false,
      toolEvents: [
        {
          agentLabel: 'Streaming',
          toolName: 'search',
          arguments: {},
          success: true,
          durationMs: 1,
        },
      ],
      finalToolEvents: [
        { agentLabel: 'Final', toolName: 'search', arguments: {}, success: true, durationMs: 1 },
      ],
      finalReasoning: 'final reasoning',
    });

    render(
      <AgentExecutionPanel
        message={createMessage({
          elapsedSeconds: 3,
          agentStatuses: [{ status: 'COMPLETED', agent_id: 0 }],
          toolEvents: [
            {
              agentLabel: 'AGENT 1',
              toolName: 'lookup',
              arguments: {},
              success: true,
              durationMs: 8,
            },
          ],
          reasoning: 'stored reasoning',
        })}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('region', { name: 'Multi-agent progress view' })).toBeDefined();
    const agentRow = screen.getByText('AGENT 1').closest('button');
    if (!agentRow) {
      throw new Error('Expected AGENT 1 row');
    }
    fireEvent.click(agentRow);
    expect(screen.getByText('Thinking')).toBeDefined();
    expect(screen.getByText('stored reasoning')).toBeDefined();
    expectToolUsage('Called Lookup');

    fireEvent.click(screen.getByText('Collapse'));
    expect(screen.queryByTestId('agent-expanded-view')).toBeNull();
  });

  it('expands via keyboard and uses live streaming events while active', () => {
    const onShowSources = vi.fn();
    setStreamingState({
      isStreaming: true,
      modelBadge: 'TASK',
      agentStatuses: [{ status: 'PROGRESS:0.5', agent_id: 0 }],
      toolEvents: [
        { agentLabel: 'AGENT 1', toolName: 'search', arguments: {}, success: true, durationMs: 5 },
      ],
      finalToolEvents: [
        { agentLabel: 'Final', toolName: 'search', arguments: {}, success: true, durationMs: 1 },
      ],
      reasoning: 'live reasoning',
      finalReasoning: 'final reasoning',
    });

    render(<AgentExecutionPanel message={createMessage()} onShowSources={onShowSources} />);

    const agentRow = screen.getByText('AGENT 1').closest('button');
    if (!agentRow) {
      throw new Error('Expected AGENT 1 row');
    }
    fireEvent.click(agentRow);

    expect(screen.getByText('TASK')).toBeDefined();
    expect(screen.getByText('Thinking')).toBeDefined();
    expect(screen.getByText('live reasoning')).toBeDefined();
    expectToolUsage('Called Search');
  });

  it('updates elapsed timer while streaming when no saved elapsed snapshot exists', () => {
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    setStreamingState({
      isStreaming: true,
      agentStatuses: [{ status: 'PROCESSING...', agent_id: 0 }],
    });

    render(<AgentExecutionPanel message={createMessage({ elapsedSeconds: undefined })} />);

    // Auto-expand fires when streaming; collapse to access compact view where timer is shown
    fireEvent.click(screen.getByText('Collapse'));
    expect(screen.getByText('0s')).toBeDefined();

    act(() => {
      now = 2100;
      vi.advanceTimersByTime(2100);
    });

    expect(screen.getByText('2s')).toBeDefined();
    nowSpy.mockRestore();
    vi.useRealTimers();
  });

  it('smooths sparse streaming progress instead of waiting at the initial value', () => {
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    setStreamingState({
      isStreaming: true,
      agentStatuses: [{ status: 'QUEUED', agent_id: 0 }],
    });

    render(<AgentExecutionPanel message={createMessage({ elapsedSeconds: undefined })} />);

    fireEvent.click(screen.getByText('Collapse'));
    const progress = screen.getByRole('progressbar', { name: 'Overall agent progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '5');

    act(() => {
      now = 12000;
      vi.advanceTimersByTime(12000);
    });

    const smoothedValue = Number(progress.getAttribute('aria-valuenow'));
    expect(smoothedValue).toBeGreaterThan(5);
    expect(smoothedValue).toBeLessThan(100);
    nowSpy.mockRestore();
    vi.useRealTimers();
  });

  it('renders pending approvals with normalized task ids and approval state', () => {
    setStreamingState({
      isStreaming: true,
      pendingApproval: { description: 'Approve command' },
      agentStatuses: [{ status: 'WAITING_FOR_APPROVAL', agent_id: 0 }],
    });

    render(<AgentExecutionPanel message={createMessage({ id: 'abc123' })} />);

    expect(screen.getByTestId('approval-card')).toBeDefined();
    expect(screen.getByText('task_abc123')).toBeDefined();
    expect(screen.getByText('Approve command')).toBeDefined();
    fireEvent.click(screen.getByText('Collapse'));
    expect(screen.getByText('Action Required')).toBeDefined();
    expect(document.querySelector('.agent-execution-dot--awaiting')).toBeTruthy();
  });

  it('renders computer theater for computer-use events and while computer use is pending', async () => {
    setStreamingState({
      isStreaming: true,
      computerUseEnabled: true,
      agentStatuses: [{ status: 'PROCESSING', agent_id: 1 }],
      toolEvents: [
        {
          agentLabel: 'Worker',
          toolName: 'computer_use',
          arguments: {},
          success: true,
          durationMs: 5,
        },
      ],
    });

    const { rerender } = render(<AgentExecutionPanel message={createMessage()} />);
    expect(await screen.findByTestId('computer-theater')).toBeDefined();

    setStreamingState({
      isStreaming: true,
      computerUseEnabled: true,
      agentStatuses: [{ status: 'PROCESSING', agent_id: 1 }],
      toolEvents: [],
    });
    rerender(<AgentExecutionPanel message={createMessage()} />);
    expect(await screen.findByTestId('computer-theater')).toBeDefined();
  });

  it('uses replay frames when the completed message carries a task id', async () => {
    setStreamingState({
      isStreaming: false,
      finalReasoning: 'final reasoning',
    });

    render(
      <AgentExecutionPanel
        message={createMessage({
          id: 'task_1',
          trace_id: 'trace-1',
          elapsedSeconds: 9,
          agentStatuses: [{ status: 'COMPLETED', agent_id: 0 }],
        })}
      />
    );

    fireEvent.click(await screen.findByTestId('execution-replay'));
    fireEvent.click(screen.getByRole('button', { name: /Completed/ }));
    const replayAgentRow = screen.getByText('AGENT 3').closest('button');
    if (!replayAgentRow) {
      throw new Error('Expected replay agent row');
    }
    fireEvent.click(replayAgentRow);

    expect(screen.getByText('AGENT 3')).toBeDefined();
    expect(screen.getByText('Thinking')).toBeDefined();
    expect(screen.getByText('replay task_1')).toBeDefined();
    expectToolUsage('Called Lookup');
  });

  it('does not fetch execution replay with a trace id as the task id', () => {
    setStreamingState({ isStreaming: false });

    render(
      <AgentExecutionPanel
        message={createMessage({
          id: 'assistant-1',
          trace_id: 'trace_task-1',
          elapsedSeconds: 9,
          agentStatuses: [{ status: 'COMPLETED', agent_id: 0 }],
        })}
      />
    );

    expect(screen.queryByTestId('execution-replay')).toBeNull();
  });
});
