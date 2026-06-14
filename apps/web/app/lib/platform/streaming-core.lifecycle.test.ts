import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const fetchEventSourceMock = vi.fn();

mock.module('@microsoft/fetch-event-source', () => ({
  fetchEventSource: fetchEventSourceMock,
}));

const { startCoreStreaming } = await import('./streaming-core');

describe('startCoreStreaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves startup on open and forwards messages', async () => {
    const controller = new AbortController();
    const handlers = {
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onError: vi.fn(),
    };
    const onMessageReceived = vi.fn();
    fetchEventSourceMock.mockImplementation(async (_url, options) => {
      await options.onopen(new Response(null, { status: 200 }));
      options.onmessage({ data: 'chunk-1' });
      options.onmessage({ data: '' });
    });

    await startCoreStreaming({
      taskId: 'task-1',
      controller,
      handlers,
      onMessageReceived,
    });

    expect(handlers.onOpen).toHaveBeenCalled();
    expect(handlers.onMessage).toHaveBeenCalledWith('chunk-1');
    expect(onMessageReceived).toHaveBeenCalledTimes(3);
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('rejects startup failures before the stream opens', async () => {
    const controller = new AbortController();
    const handlers = {
      onError: vi.fn(),
    };
    fetchEventSourceMock.mockImplementation(async (_url, options) => {
      await options.onopen(new Response(null, { status: 503 }));
    });

    await expect(
      startCoreStreaming({
        taskId: 'task-2',
        controller,
        handlers,
        connectionFailedMessage: 'Could not connect',
      })
    ).rejects.toThrow('Could not connect');

    expect(handlers.onError).toHaveBeenCalled();
  });

  it('reports connection loss after the stream has opened', async () => {
    const controller = new AbortController();
    const handlers = {
      onOpen: vi.fn(),
      onError: vi.fn(),
    };
    const onConnectionLost = vi.fn();
    fetchEventSourceMock.mockImplementation(async (_url, options) => {
      await options.onopen(new Response(null, { status: 200 }));
      options.onerror(new Error('temporary drop'));
      throw new Error('final drop');
    });

    await startCoreStreaming({
      taskId: 'task-3',
      controller,
      handlers,
      onConnectionLost,
    });
    await Promise.resolve();

    expect(onConnectionLost).toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('settles startup without reporting errors when aborted before open', async () => {
    const controller = new AbortController();
    const handlers = {
      onError: vi.fn(),
    };
    fetchEventSourceMock.mockImplementation(async (_url, options) => {
      controller.abort();
      options.onerror(new Error('aborted'));
      throw new Error('aborted catch');
    });

    const startPromise = startCoreStreaming({
      taskId: 'task-4',
      controller,
      handlers,
    });

    await Promise.resolve();
    await expect(startPromise).resolves.toBeUndefined();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('settles startup when the signal is already aborted', async () => {
    const controller = new AbortController();
    const handlers = {
      onError: vi.fn(),
    };
    controller.abort();
    fetchEventSourceMock.mockImplementation(async () => {});

    await expect(
      startCoreStreaming({
        taskId: 'task-5',
        controller,
        handlers,
      })
    ).resolves.toBeUndefined();

    expect(handlers.onError).not.toHaveBeenCalled();
  });
});
