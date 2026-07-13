import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { act, renderHook } from '@testing-library/react';

import '../../../../../../tests/setup/dom';

import {
  createDeferred,
  createRealtimeSessionFixture,
  experimentalUseRealtimeMock,
  getCsrfTokenMock,
  getStoredTokenMock,
  installRealtimeBrowserTestEnvironment,
  loadModule,
  MockAudioWorkletNode,
  usePlatformRuntimeMock,
} from './useRealtimeVoiceSession.test-fixtures';

describe('connectRealtimeWithCsrf startup', () => {
  let restoreBrowserEnvironment: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restoreBrowserEnvironment = installRealtimeBrowserTestEnvironment();
    getCsrfTokenMock.mockResolvedValue('csrf-token');
    getStoredTokenMock.mockReturnValue({ ok: true, value: 'browser-token' });
    usePlatformRuntimeMock.mockReturnValue('browser');
  });

  afterEach(() => {
    restoreBrowserEnvironment();
  });

  it('starts microphone capture before realtime setup finishes', async () => {
    const track = { stop: vi.fn() };
    const stream = {
      getTracks: vi.fn(() => [track]),
    } as unknown as MediaStream;
    const connectDeferred = createDeferred<void>();
    const streamDeferred = createDeferred<MediaStream>();
    const realtimeSession = createRealtimeSessionFixture({
      connect: vi.fn(() => connectDeferred.promise),
    });
    experimentalUseRealtimeMock.mockReturnValue(realtimeSession);
    const getUserMedia = vi.fn(() => streamDeferred.promise);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    const { useRealtimeVoiceSession } = await loadModule();
    const setErrorMessage = vi.fn();

    const { result, unmount } = renderHook(() => useRealtimeVoiceSession({ setErrorMessage }));
    let connectPromise: Promise<void>;
    let didConnectResolve = false;
    await act(async () => {
      connectPromise = result.current.connect();
      void connectPromise.then(() => {
        didConnectResolve = true;
      });
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(realtimeSession.connect).toHaveBeenCalledTimes(1);

    streamDeferred.resolve(stream);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(MockAudioWorkletNode.instances[0]).toBeDefined();
    expect(didConnectResolve).toBe(false);

    connectDeferred.resolve();
    await act(async () => {
      await connectPromise;
    });

    expect(didConnectResolve).toBe(true);
    unmount();
  });

  it('keeps browser microphone capture when the realtime hook output changes during startup', async () => {
    const track = { stop: vi.fn() };
    const stream = {
      getTracks: vi.fn(() => [track]),
    } as unknown as MediaStream;
    const connectDeferred = createDeferred<void>();
    const streamDeferred = createDeferred<MediaStream>();
    const initialSession = createRealtimeSessionFixture({
      connect: vi.fn(() => connectDeferred.promise),
    });
    const connectedSession = {
      ...initialSession,
      sendAudio: vi.fn(),
      status: 'connected' as 'disconnected' | 'connecting' | 'connected' | 'error',
    };
    let realtimeSession = initialSession;
    experimentalUseRealtimeMock.mockImplementation(() => realtimeSession);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => streamDeferred.promise),
      },
    });
    const { useRealtimeVoiceSession } = await loadModule();
    const setErrorMessage = vi.fn();

    const { result, rerender, unmount } = renderHook(() =>
      useRealtimeVoiceSession({ setErrorMessage })
    );
    let connectPromise: Promise<void>;
    await act(async () => {
      connectPromise = result.current.connect();
      await Promise.resolve();
    });

    realtimeSession = connectedSession;
    rerender();
    streamDeferred.resolve(stream);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isCapturing).toBe(true);
    const node = MockAudioWorkletNode.instances[0];
    if (!node) {
      throw new Error('Expected AudioWorklet microphone node');
    }
    node.port.dispatchSamples(new Float32Array([0.25, -0.25]));

    expect(connectedSession.sendAudio).toHaveBeenCalledWith(expect.any(String));
    expect(initialSession.sendAudio).not.toHaveBeenCalled();

    connectDeferred.resolve();
    await act(async () => {
      await connectPromise;
    });

    unmount();
  });

  it('queues browser microphone audio until the realtime socket is connected', async () => {
    const track = { stop: vi.fn() };
    const stream = {
      getTracks: vi.fn(() => [track]),
    } as unknown as MediaStream;
    const realtimeSession = createRealtimeSessionFixture();
    experimentalUseRealtimeMock.mockReturnValue(realtimeSession);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => stream),
      },
    });
    const { useRealtimeVoiceSession } = await loadModule();
    const setErrorMessage = vi.fn();

    const { result, rerender, unmount } = renderHook(() =>
      useRealtimeVoiceSession({ setErrorMessage })
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(realtimeSession.connect).toHaveBeenCalled();
    expect(realtimeSession.startAudioCapture).not.toHaveBeenCalled();
    const node = MockAudioWorkletNode.instances[0];
    if (!node) {
      throw new Error('Expected AudioWorklet microphone node');
    }
    node.port.dispatchSamples(new Float32Array([0, 0.5, -0.5]));
    expect(realtimeSession.sendAudio).not.toHaveBeenCalled();

    realtimeSession.status = 'connected';
    rerender();
    await act(async () => {
      await Promise.resolve();
    });

    expect(realtimeSession.sendAudio).toHaveBeenCalledWith(expect.any(String));
    expect(setErrorMessage).not.toHaveBeenCalled();

    unmount();
    expect(node.port.close).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });

  it('cleans up partial browser realtime startup when readiness times out', async () => {
    vi.useFakeTimers();
    try {
      const track = { stop: vi.fn() };
      const stream = {
        getTracks: vi.fn(() => [track]),
      } as unknown as MediaStream;
      const realtimeSession = createRealtimeSessionFixture();
      experimentalUseRealtimeMock.mockReturnValue(realtimeSession);
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: vi.fn(async () => stream),
        },
      });
      const { useRealtimeVoiceSession } = await loadModule();
      const setErrorMessage = vi.fn();

      const { result, unmount } = renderHook(() => useRealtimeVoiceSession({ setErrorMessage }));

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.isActive).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(8_000);
        await Promise.resolve();
      });

      expect(setErrorMessage).toHaveBeenCalledWith(
        'Realtime voice took too long to connect. Please try again.'
      );
      expect(realtimeSession.stopAudioCapture).toHaveBeenCalled();
      expect(realtimeSession.stopPlayback).toHaveBeenCalled();
      expect(realtimeSession.disconnect).toHaveBeenCalled();
      expect(track.stop).toHaveBeenCalled();

      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops late microphone streams that resolve after realtime startup timeout', async () => {
    vi.useFakeTimers();
    try {
      const track = { stop: vi.fn() };
      const stream = {
        getTracks: vi.fn(() => [track]),
      } as unknown as MediaStream;
      const connectDeferred = createDeferred<void>();
      const streamDeferred = createDeferred<MediaStream>();
      const realtimeSession = createRealtimeSessionFixture({
        connect: vi.fn(() => connectDeferred.promise),
      });
      experimentalUseRealtimeMock.mockReturnValue(realtimeSession);
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: vi.fn(() => streamDeferred.promise),
        },
      });
      const { useRealtimeVoiceSession } = await loadModule();
      const setErrorMessage = vi.fn();

      const { result, unmount } = renderHook(() => useRealtimeVoiceSession({ setErrorMessage }));
      let connectPromise: Promise<void>;
      await act(async () => {
        connectPromise = result.current.connect();
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(8_000);
        await Promise.resolve();
      });

      expect(setErrorMessage).toHaveBeenCalledWith(
        'Realtime voice took too long to connect. Please try again.'
      );
      expect(realtimeSession.disconnect).toHaveBeenCalled();

      streamDeferred.resolve(stream);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(track.stop).toHaveBeenCalled();
      expect(MockAudioWorkletNode.instances).toHaveLength(0);
      expect(result.current.isCapturing).toBe(false);

      connectDeferred.resolve();
      await act(async () => {
        await connectPromise;
      });

      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('requests realtime audio and transcript formats in the session config', async () => {
    const realtimeSession = createRealtimeSessionFixture();
    experimentalUseRealtimeMock.mockReturnValue(realtimeSession);
    const { useRealtimeVoiceSession } = await loadModule();

    renderHook(() => useRealtimeVoiceSession({ setErrorMessage: vi.fn() }));

    expect(experimentalUseRealtimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionConfig: expect.objectContaining({
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          outputModalities: ['audio'],
        }),
      })
    );
  });

  it('does not notify the parent for repeated empty transcript snapshots', async () => {
    const realtimeSession = createRealtimeSessionFixture();
    experimentalUseRealtimeMock.mockReturnValue(realtimeSession);
    const onMessagesChange = vi.fn();
    const { useRealtimeVoiceSession } = await loadModule();

    const { rerender } = renderHook(() =>
      useRealtimeVoiceSession({ onMessagesChange, setErrorMessage: vi.fn() })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(onMessagesChange).not.toHaveBeenCalled();

    realtimeSession.messages = [];
    rerender();
    await act(async () => {
      await Promise.resolve();
    });

    expect(onMessagesChange).not.toHaveBeenCalled();
  });

  it('builds realtime transcript messages from speech and assistant events', async () => {
    const realtimeSession = createRealtimeSessionFixture({ status: 'connected' });
    experimentalUseRealtimeMock.mockReturnValue(realtimeSession);
    const onMessagesChange = vi.fn();
    const { useRealtimeVoiceSession } = await loadModule();

    const { result } = renderHook(() =>
      useRealtimeVoiceSession({ onMessagesChange, setErrorMessage: vi.fn() })
    );
    const options = experimentalUseRealtimeMock.mock.calls.at(-1)?.[0] as {
      onEvent?: (event: unknown) => void;
    };

    await act(async () => {
      options.onEvent?.({ type: 'speech-started', itemId: 'user-1' });
    });
    expect(result.current.messages).toEqual([
      {
        id: 'user-user-1',
        role: 'user',
        text: 'Listening...',
        isStreaming: true,
        isEphemeral: true,
      },
    ]);
    expect(onMessagesChange).not.toHaveBeenCalled();

    await act(async () => {
      options.onEvent?.({ type: 'speech-stopped', itemId: 'user-1' });
    });
    expect(result.current.messages).toEqual([
      {
        id: 'user-user-1',
        role: 'user',
        text: 'Transcribing...',
        isStreaming: true,
        isEphemeral: true,
      },
    ]);
    expect(onMessagesChange).not.toHaveBeenCalled();

    await act(async () => {
      options.onEvent?.({
        type: 'input-transcription-completed',
        itemId: 'user-1',
        transcript: 'hello there',
      });
      options.onEvent?.({ type: 'audio-transcript-delta', itemId: 'assistant-1', delta: 'Hi ' });
      options.onEvent?.({
        type: 'audio-transcript-done',
        itemId: 'assistant-1',
        transcript: 'Hi there.',
      });
    });

    expect(result.current.messages).toEqual([
      { id: 'user-user-1', role: 'user', text: 'hello there' },
      {
        id: 'assistant-assistant-1',
        role: 'assistant',
        text: 'Hi there.',
        isStreaming: false,
      },
    ]);
    expect(onMessagesChange).toHaveBeenCalledWith(result.current.messages);
  });
});
