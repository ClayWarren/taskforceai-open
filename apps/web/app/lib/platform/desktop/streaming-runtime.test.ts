import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const mockWaitForTauriBridge = mock(() => Promise.resolve());
const mockGetDesktopAppServerRunStatus = vi.fn();
const mockCancelDesktopAppServerRun = vi.fn();

mock.module('./bridge', () => ({
  waitForTauriBridge: mockWaitForTauriBridge,
}));

mock.module('./app-server', () => ({
  getDesktopAppServerRunStatus: mockGetDesktopAppServerRunStatus,
  cancelDesktopAppServerRun: mockCancelDesktopAppServerRun,
}));

const loadRuntime = async () => {
  const module = await import('./streaming-runtime');
  return module.createDesktopStreamingRuntime();
};

const waitForMessages = async (messages: string[], count: number, attempts = 40): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (messages.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${count} messages, got ${messages.length}`);
};

const waitForMessageType = async (
  messages: string[],
  type: string,
  attempts = 80
): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (messages.some((message) => JSON.parse(message).type === type)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected message type ${type}`);
};

beforeEach(() => {
  vi.useRealTimers();
  mockWaitForTauriBridge.mockClear();
  mockGetDesktopAppServerRunStatus.mockReset();
  mockCancelDesktopAppServerRun.mockReset();
});

describe('DesktopStreamingRuntime', () => {
  const createHandlers = () => {
    const messages: string[] = [];
    return {
      messages,
      handlers: {
        onOpen: vi.fn(),
        onMessage: vi.fn((message: string) => {
          messages.push(message);
        }),
        onError: vi.fn(),
      },
    };
  };

  it('waits for bridge and emits start before polling run status', async () => {
    mockGetDesktopAppServerRunStatus.mockResolvedValue({
      run: {
        id: 'task-1',
        status: 'processing',
        output: null,
        error: null,
        updatedAt: 1,
      },
    });
    const runtime = await loadRuntime();
    const { handlers, messages } = createHandlers();

    await runtime.startStreaming('task-1', handlers);

    expect(mockWaitForTauriBridge).toHaveBeenCalledTimes(1);
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(JSON.parse(messages[0] ?? '{}')).toMatchObject({
      type: 'start',
      task_id: 'task-1',
    });
    runtime.stopStreaming();
  });

  it('emits progress and complete payloads from app-server run status', async () => {
    mockGetDesktopAppServerRunStatus
      .mockResolvedValueOnce({
        run: {
          id: 'task-2',
          status: 'processing',
          output: null,
          error: null,
          updatedAt: 1,
        },
      })
      .mockResolvedValue({
        run: {
          id: 'task-2',
          status: 'completed',
          output: 'Done from desktop',
          error: null,
          updatedAt: 2,
        },
      });
    const runtime = await loadRuntime();
    const { handlers, messages } = createHandlers();

    await runtime.startStreaming('task-2', handlers);
    await waitForMessageType(messages, 'complete', 120);

    const parsedMessages = messages.map((message) => JSON.parse(message));
    const progressMessages = parsedMessages.filter((message) => message.type === 'progress');
    expect(progressMessages.length).toBeGreaterThanOrEqual(3);
    expect(
      progressMessages.some(
        (message) =>
          message.agent_statuses?.[0]?.progress > 0.5 && message.agent_statuses?.[0]?.progress < 1
      )
    ).toBe(true);
    expect(JSON.parse(messages.at(-1) ?? '{}')).toMatchObject({
      type: 'complete',
      task_id: 'task-2',
      message: 'Done from desktop',
    });
  });

  it('includes live tool usage in desktop progress payloads', async () => {
    mockGetDesktopAppServerRunStatus.mockResolvedValue({
      run: {
        id: 'task-computer',
        status: 'processing',
        output: null,
        error: null,
        updatedAt: 7,
        toolEvents: [
          {
            toolName: 'computer_use',
            arguments: '{"action":"screenshot"}',
            image_base64: 'screen-frame',
          },
        ],
      },
    });
    const runtime = await loadRuntime();
    const { handlers, messages } = createHandlers();

    await runtime.startStreaming('task-computer', handlers);
    await waitForMessages(messages, 2);

    const progress = messages
      .map((message) => JSON.parse(message))
      .find((message) => {
        return message.type === 'progress' && message.task_id === 'task-computer';
      });
    expect(progress?.tool_usage).toEqual([
      {
        toolName: 'computer_use',
        arguments: '{"action":"screenshot"}',
        image_base64: 'screen-frame',
      },
    ]);
    runtime.stopStreaming();
  });

  it('emits progress when tool events change without an updated timestamp', async () => {
    mockGetDesktopAppServerRunStatus
      .mockResolvedValueOnce({
        run: {
          id: 'task-computer-same-time',
          status: 'processing',
          output: null,
          error: null,
          updatedAt: 10,
          toolEvents: [],
        },
      })
      .mockResolvedValue({
        run: {
          id: 'task-computer-same-time',
          status: 'processing',
          output: null,
          error: null,
          updatedAt: 10,
          toolEvents: [
            {
              toolName: 'computer_use',
              arguments: { action: 'screenshot' },
              status: 'running',
            },
          ],
        },
      });
    const runtime = await loadRuntime();
    const { handlers, messages } = createHandlers();

    await runtime.startStreaming('task-computer-same-time', handlers);
    await waitForMessages(messages, 3, 80);

    const progressMessages = messages
      .map((message) => JSON.parse(message))
      .filter((message) => message.type === 'progress');
    expect(progressMessages.at(-1)?.tool_usage).toEqual([
      {
        toolName: 'computer_use',
        arguments: { action: 'screenshot' },
        status: 'running',
      },
    ]);
    runtime.stopStreaming();
  });

  it('emits a new frame when same-length image content changes', async () => {
    mockGetDesktopAppServerRunStatus
      .mockResolvedValueOnce({
        run: {
          id: 'task-changing-frame',
          status: 'processing',
          output: null,
          error: null,
          updatedAt: 10,
          toolEvents: [{ toolName: 'computer_use', image_base64: 'frame-a' }],
        },
      })
      .mockResolvedValue({
        run: {
          id: 'task-changing-frame',
          status: 'processing',
          output: null,
          error: null,
          updatedAt: 10,
          toolEvents: [{ toolName: 'computer_use', image_base64: 'frame-b' }],
        },
      });
    const runtime = await loadRuntime();
    const { handlers, messages } = createHandlers();

    await runtime.startStreaming('task-changing-frame', handlers);
    await waitForMessages(messages, 3, 80);

    const progressMessages = messages
      .map((message) => JSON.parse(message))
      .filter((message) => message.type === 'progress');
    expect(progressMessages.at(-1)?.tool_usage[0]?.image_base64).toBe('frame-b');
    runtime.stopStreaming();
  });

  it('does not emit completion after streaming is stopped during the completion ramp', async () => {
    mockGetDesktopAppServerRunStatus.mockResolvedValue({
      run: {
        id: 'task-stop-ramp',
        status: 'completed',
        output: 'too late',
        error: null,
        updatedAt: 1,
      },
    });
    const runtime = await loadRuntime();
    const { handlers, messages } = createHandlers();

    await runtime.startStreaming('task-stop-ramp', handlers);
    await waitForMessages(messages, 3);
    runtime.stopStreaming();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(messages.map((message) => JSON.parse(message).type)).not.toContain('complete');
  });

  it('emits error payload when app-server marks the run failed', async () => {
    mockGetDesktopAppServerRunStatus.mockResolvedValue({
      run: {
        id: 'task-3',
        status: 'failed',
        output: null,
        error: 'api error',
        updatedAt: 1,
      },
    });
    const runtime = await loadRuntime();
    const { handlers, messages } = createHandlers();

    await runtime.startStreaming('task-3', handlers);
    await waitForMessages(messages, 3);

    expect(JSON.parse(messages.at(-1) ?? '{}')).toMatchObject({
      type: 'error',
      task_id: 'task-3',
      error: 'api error',
    });
  });

  it('stops polling when stopped', async () => {
    mockGetDesktopAppServerRunStatus.mockResolvedValue({
      run: {
        id: 'task-4',
        status: 'processing',
        output: null,
        error: null,
        updatedAt: 1,
      },
    });
    const runtime = await loadRuntime();
    const { handlers } = createHandlers();

    await runtime.startStreaming('task-4', handlers);
    runtime.stopStreaming();
    const callsAfterStop = mockGetDesktopAppServerRunStatus.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 650));

    expect(mockGetDesktopAppServerRunStatus.mock.calls.length).toBe(callsAfterStop);
  });

  it('cancels app-server runs through the desktop bridge', async () => {
    const runtime = await loadRuntime();

    await runtime.cancelTask?.('task-5');

    expect(mockCancelDesktopAppServerRun).toHaveBeenCalledWith('task-5');
  });
});
