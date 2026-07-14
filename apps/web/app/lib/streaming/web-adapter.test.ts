import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import { createWebStreamingAdapter } from './web-adapter';

const detectRuntimeMock = mock(() => 'browser');
const browserStartStreamingMock = vi.fn();
const browserStopStreamingMock = vi.fn();
const desktopStartStreamingMock = vi.fn();
const desktopStopStreamingMock = vi.fn();
const desktopCancelTaskMock = vi.fn();
const cancelTaskMock = vi.fn();

mock.module('@taskforceai/browser-runtime/runtime', () => ({
  detectRuntime: detectRuntimeMock,
}));

mock.module('@taskforceai/api-client/api/tasks', () => ({
  cancelTask: cancelTaskMock,
}));

mock.module('../platform/browser/streaming-runtime', () => ({
  createBrowserStreamingRuntime: () => ({
    startStreaming: browserStartStreamingMock,
    stopStreaming: browserStopStreamingMock,
  }),
}));

mock.module('../platform/desktop-api', () => ({
  createDesktopStreamingRuntime: () => ({
    startStreaming: desktopStartStreamingMock,
    stopStreaming: desktopStopStreamingMock,
    cancelTask: desktopCancelTaskMock,
  }),
}));

describe('createWebStreamingAdapter', () => {
  beforeEach(() => {
    detectRuntimeMock.mockReset();
    detectRuntimeMock.mockReturnValue('browser');
    browserStartStreamingMock.mockReset();
    browserStopStreamingMock.mockReset();
    desktopStartStreamingMock.mockReset();
    desktopStopStreamingMock.mockReset();
    desktopCancelTaskMock.mockReset();
    cancelTaskMock.mockReset();
  });

  it('connects through the browser streaming runtime', async () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onOpen = vi.fn();
    browserStartStreamingMock.mockResolvedValue(undefined);

    const adapter = createWebStreamingAdapter();
    const disconnect = await adapter.connect('task-1', onMessage, onError, onOpen);

    expect(browserStartStreamingMock).toHaveBeenCalledWith('task-1', {
      onOpen,
      onMessage,
      onError,
    });

    disconnect();
    expect(browserStopStreamingMock).toHaveBeenCalled();
  });

  it('connects through the cached desktop streaming runtime', async () => {
    detectRuntimeMock.mockReturnValue('desktop');
    desktopStartStreamingMock.mockResolvedValue(undefined);

    const adapter = createWebStreamingAdapter();
    const firstDisconnect = await adapter.connect('task-2', vi.fn(), vi.fn(), vi.fn());
    const secondDisconnect = await adapter.connect('task-3', vi.fn(), vi.fn(), vi.fn());

    expect(desktopStartStreamingMock).toHaveBeenCalledTimes(2);
    expect(desktopStartStreamingMock.mock.calls[0]?.[0]).toBe('task-2');
    expect(desktopStartStreamingMock.mock.calls[1]?.[0]).toBe('task-3');

    firstDisconnect();
    secondDisconnect();
    expect(desktopStopStreamingMock).toHaveBeenCalledTimes(2);
  });

  it('cancels browser tasks through the task API', async () => {
    cancelTaskMock.mockResolvedValue({ ok: true, data: { id: 'task-4', status: 'cancelled' } });

    const adapter = createWebStreamingAdapter();
    const { cancelTask } = adapter;

    expect(cancelTask).toBeDefined();
    if (!cancelTask) throw new Error('Expected cancelTask to be defined');
    await cancelTask('task-4');

    expect(cancelTaskMock).toHaveBeenCalledWith('task-4');
    expect(desktopCancelTaskMock).not.toHaveBeenCalled();
  });

  it('throws browser task API cancellation failures', async () => {
    cancelTaskMock.mockResolvedValue({
      ok: false,
      error: { message: 'Unable to cancel task' },
    });

    const adapter = createWebStreamingAdapter();
    const { cancelTask } = adapter;

    expect(cancelTask).toBeDefined();
    if (!cancelTask) throw new Error('Expected cancelTask to be defined');
    await expect(cancelTask('task-5')).rejects.toThrow('Unable to cancel task');
  });

  it('cancels desktop tasks through the desktop runtime', async () => {
    detectRuntimeMock.mockReturnValue('desktop');
    desktopCancelTaskMock.mockResolvedValue(undefined);

    const adapter = createWebStreamingAdapter();
    const { cancelTask } = adapter;

    expect(cancelTask).toBeDefined();
    if (!cancelTask) throw new Error('Expected cancelTask to be defined');
    await cancelTask('task-6');

    expect(desktopCancelTaskMock).toHaveBeenCalledWith('task-6');
    expect(cancelTaskMock).not.toHaveBeenCalled();
  });
});
