import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { act, renderHook } from '@testing-library/react';

import '../../../../../../tests/setup/dom';

import { REALTIME_INPUT_SAMPLE_RATE } from '@taskforceai/client-runtime';

const getCsrfTokenMock = vi.fn();
const getStoredTokenMock = vi.fn();
const experimentalUseRealtimeMock = vi.fn();
const useDesktopRealtimeVoiceSessionMock = vi.fn(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  endedDurationMs: null,
  isActive: false,
  isCapturing: false,
  isPlaying: false,
  messages: [],
  prewarm: vi.fn(),
  status: 'disconnected',
}));
const loggerErrorMock = vi.fn();
const loggerDebugMock = vi.fn();
const usePlatformRuntimeMock = vi.fn(() => 'browser');

vi.mock('@taskforceai/api-client/auth/auth-storage', () => ({
  getStoredToken: getStoredTokenMock,
}));

vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  getCsrfToken: getCsrfTokenMock,
}));

vi.mock('@ai-sdk/react', () => ({
  experimental_useRealtime: experimentalUseRealtimeMock,
}));

vi.mock('../../../lib/logger', () => ({
  logger: {
    debug: loggerDebugMock,
    error: loggerErrorMock,
  },
}));

vi.mock('../../../lib/platform/PlatformProvider', () => ({
  usePlatformRuntime: usePlatformRuntimeMock,
}));

vi.mock('./useDesktopRealtimeVoiceSession', () => ({
  useDesktopRealtimeVoiceSession: useDesktopRealtimeVoiceSessionMock,
}));

const loadModule = async () => import('./useRealtimeVoiceSession');

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

class MockMediaStreamAudioSourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioWorklet {
  addModule = vi.fn(async () => undefined);
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];

  audioWorklet: MockAudioWorklet | undefined = new MockAudioWorklet();
  destination = {};
  sampleRate = REALTIME_INPUT_SAMPLE_RATE;
  close = vi.fn(async () => undefined);
  createMediaStreamSource = vi.fn(() => new MockMediaStreamAudioSourceNode());

  constructor(options?: AudioContextOptions) {
    this.sampleRate = options?.sampleRate ?? REALTIME_INPUT_SAMPLE_RATE;
    MockAudioContext.instances.push(this);
  }
}

class MockMessagePort {
  close = vi.fn();
  start = vi.fn();
  private listener: ((event: MessageEvent<Float32Array>) => void) | null = null;

  addEventListener = vi.fn(
    (eventName: string, listener: (event: MessageEvent<Float32Array>) => void) => {
      if (eventName === 'message') {
        this.listener = listener;
      }
    }
  );

  dispatchSamples(samples: Float32Array) {
    this.listener?.({ data: samples } as MessageEvent<Float32Array>);
  }
}

class MockAudioWorkletNode {
  static instances: MockAudioWorkletNode[] = [];

  connect = vi.fn();
  disconnect = vi.fn();
  port = new MockMessagePort();

  constructor(
    public readonly context: AudioContext,
    public readonly name: string,
    public readonly options: AudioWorkletNodeOptions
  ) {
    MockAudioWorkletNode.instances.push(this);
  }
}

describe('connectRealtimeWithCsrf startup', () => {
  let originalFetch: typeof globalThis.fetch;

  let originalMediaDevicesDescriptor: PropertyDescriptor | undefined;

  let originalAudioContextDescriptor: PropertyDescriptor | undefined;

  let originalAudioWorkletNodeDescriptor: PropertyDescriptor | undefined;

  let originalCreateObjectURLDescriptor: PropertyDescriptor | undefined;

  let originalRevokeObjectURLDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    MockAudioContext.instances = [];
    MockAudioWorkletNode.instances = [];
    originalFetch = globalThis.fetch;
    originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    originalAudioContextDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext');
    originalAudioWorkletNodeDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'AudioWorkletNode'
    );
    originalCreateObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    originalRevokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext,
    });
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      configurable: true,
      value: MockAudioWorkletNode,
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:realtime-worklet'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    getCsrfTokenMock.mockResolvedValue('csrf-token');
    getStoredTokenMock.mockReturnValue({ ok: true, value: 'browser-token' });
    usePlatformRuntimeMock.mockReturnValue('browser');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalMediaDevicesDescriptor) {
      Object.defineProperty(navigator, 'mediaDevices', originalMediaDevicesDescriptor);
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
    if (originalAudioContextDescriptor) {
      Object.defineProperty(window, 'AudioContext', originalAudioContextDescriptor);
    } else {
      Reflect.deleteProperty(window, 'AudioContext');
    }
    if (originalAudioWorkletNodeDescriptor) {
      Object.defineProperty(globalThis, 'AudioWorkletNode', originalAudioWorkletNodeDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
    }
    if (originalCreateObjectURLDescriptor) {
      Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURLDescriptor);
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL');
    }
    if (originalRevokeObjectURLDescriptor) {
      Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURLDescriptor);
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('starts microphone capture before realtime setup finishes', async () => {
    const track = { stop: vi.fn() };
    const stream = {
      getTracks: vi.fn(() => [track]),
    } as unknown as MediaStream;
    const connectDeferred = createDeferred<void>();
    const streamDeferred = createDeferred<MediaStream>();
    const realtimeSession = {
      addToolOutput: vi.fn(),
      cancelResponse: vi.fn(),
      clearAudioBuffer: vi.fn(),
      commitAudio: vi.fn(),
      connect: vi.fn(() => connectDeferred.promise),
      disconnect: vi.fn(),
      events: [],
      isCapturing: false,
      isPlaying: false,
      messages: [],
      requestResponse: vi.fn(),
      sendAudio: vi.fn(),
      sendEvent: vi.fn(),
      sendTextMessage: vi.fn(),
      startAudioCapture: vi.fn(),
      status: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'error',
      stopAudioCapture: vi.fn(),
      stopPlayback: vi.fn(),
    };
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
    const initialSession = {
      addToolOutput: vi.fn(),
      cancelResponse: vi.fn(),
      clearAudioBuffer: vi.fn(),
      commitAudio: vi.fn(),
      connect: vi.fn(() => connectDeferred.promise),
      disconnect: vi.fn(),
      events: [],
      isCapturing: false,
      isPlaying: false,
      messages: [],
      requestResponse: vi.fn(),
      sendAudio: vi.fn(),
      sendEvent: vi.fn(),
      sendTextMessage: vi.fn(),
      startAudioCapture: vi.fn(),
      status: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'error',
      stopAudioCapture: vi.fn(),
      stopPlayback: vi.fn(),
    };
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
    const realtimeSession = {
      addToolOutput: vi.fn(),
      cancelResponse: vi.fn(),
      clearAudioBuffer: vi.fn(),
      commitAudio: vi.fn(),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(),
      events: [],
      isCapturing: false,
      isPlaying: false,
      messages: [],
      requestResponse: vi.fn(),
      sendAudio: vi.fn(),
      sendEvent: vi.fn(),
      sendTextMessage: vi.fn(),
      startAudioCapture: vi.fn(),
      status: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'error',
      stopAudioCapture: vi.fn(),
      stopPlayback: vi.fn(),
    };
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
      const realtimeSession = {
        addToolOutput: vi.fn(),
        cancelResponse: vi.fn(),
        clearAudioBuffer: vi.fn(),
        commitAudio: vi.fn(),
        connect: vi.fn(async () => {}),
        disconnect: vi.fn(),
        events: [],
        isCapturing: false,
        isPlaying: false,
        messages: [],
        requestResponse: vi.fn(),
        sendAudio: vi.fn(),
        sendEvent: vi.fn(),
        sendTextMessage: vi.fn(),
        startAudioCapture: vi.fn(),
        status: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'error',
        stopAudioCapture: vi.fn(),
        stopPlayback: vi.fn(),
      };
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
      const realtimeSession = {
        addToolOutput: vi.fn(),
        cancelResponse: vi.fn(),
        clearAudioBuffer: vi.fn(),
        commitAudio: vi.fn(),
        connect: vi.fn(() => connectDeferred.promise),
        disconnect: vi.fn(),
        events: [],
        isCapturing: false,
        isPlaying: false,
        messages: [],
        requestResponse: vi.fn(),
        sendAudio: vi.fn(),
        sendEvent: vi.fn(),
        sendTextMessage: vi.fn(),
        startAudioCapture: vi.fn(),
        status: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'error',
        stopAudioCapture: vi.fn(),
        stopPlayback: vi.fn(),
      };
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
    const realtimeSession = {
      addToolOutput: vi.fn(),
      cancelResponse: vi.fn(),
      clearAudioBuffer: vi.fn(),
      commitAudio: vi.fn(),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(),
      events: [],
      isCapturing: false,
      isPlaying: false,
      messages: [],
      requestResponse: vi.fn(),
      sendAudio: vi.fn(),
      sendEvent: vi.fn(),
      sendTextMessage: vi.fn(),
      startAudioCapture: vi.fn(),
      status: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'error',
      stopAudioCapture: vi.fn(),
      stopPlayback: vi.fn(),
    };
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
    const realtimeSession = {
      addToolOutput: vi.fn(),
      cancelResponse: vi.fn(),
      clearAudioBuffer: vi.fn(),
      commitAudio: vi.fn(),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(),
      events: [],
      isCapturing: false,
      isPlaying: false,
      messages: [],
      requestResponse: vi.fn(),
      sendAudio: vi.fn(),
      sendEvent: vi.fn(),
      sendTextMessage: vi.fn(),
      startAudioCapture: vi.fn(),
      status: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'error',
      stopAudioCapture: vi.fn(),
      stopPlayback: vi.fn(),
    };
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
    const realtimeSession = {
      addToolOutput: vi.fn(),
      cancelResponse: vi.fn(),
      clearAudioBuffer: vi.fn(),
      commitAudio: vi.fn(),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(),
      events: [],
      isCapturing: false,
      isPlaying: false,
      messages: [],
      requestResponse: vi.fn(),
      sendAudio: vi.fn(),
      sendEvent: vi.fn(),
      sendTextMessage: vi.fn(),
      startAudioCapture: vi.fn(),
      status: 'connected' as 'disconnected' | 'connecting' | 'connected' | 'error',
      stopAudioCapture: vi.fn(),
      stopPlayback: vi.fn(),
    };
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
