import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import { createWebStreamingAdapter } from './web-adapter';

const detectRuntimeMock = mock(() => 'browser');
const browserStartStreamingMock = vi.fn();
const browserStopStreamingMock = vi.fn();
const desktopStartStreamingMock = vi.fn();
const desktopStopStreamingMock = vi.fn();

mock.module('@taskforceai/shared/utils/runtime', () => ({
  detectRuntime: detectRuntimeMock,
}));

mock.module('../platform/browser/streaming-runtime', () => ({
  createBrowserStreamingRuntime: () => ({
    startStreaming: browserStartStreamingMock,
    stopStreaming: browserStopStreamingMock,
  }),
}));

mock.module('../platform/desktop/streaming-runtime', () => ({
  createDesktopStreamingRuntime: () => ({
    startStreaming: desktopStartStreamingMock,
    stopStreaming: desktopStopStreamingMock,
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
});
