import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { act, renderHook } from '@testing-library/react';

import '../../../../../../tests/setup/dom';

import { REALTIME_INPUT_SAMPLE_RATE, REALTIME_SETUP_ENDPOINT } from '@taskforceai/client-runtime';

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

vi.mock('@taskforceai/contracts/auth/auth-storage', () => ({
  getStoredToken: getStoredTokenMock,
}));

vi.mock('@taskforceai/contracts/auth/csrf', () => ({
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

type FetchTestMock = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
> &
  typeof fetch;

const createFetchMock = (): FetchTestMock => {
  const mock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response('{}')
  );
  return Object.assign(mock, {
    preconnect: vi.fn<typeof globalThis.fetch.preconnect>(),
  }) as FetchTestMock;
};

describe.serial('connectRealtimeWithCsrf', () => {
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

  it('adds auth and csrf to realtime setup requests and restores fetch after connect', async () => {
    const fetchMock = createFetchMock();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf } = await loadModule();

    await connectRealtimeWithCsrf(async () => {
      await fetch(REALTIME_SETUP_ENDPOINT, {
        headers: { 'Content-Type': 'application/json' },
      });
      await fetch('/api/other', {
        headers: { Accept: 'application/json' },
      });
    });

    expect(globalThis.fetch).toBe(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const setupCall = fetchMock.mock.calls[0];
    const otherCall = fetchMock.mock.calls[1];
    if (!setupCall || !otherCall) {
      throw new Error('Expected realtime and non-realtime fetch calls');
    }

    const setupHeaders = new Headers(setupCall[1]?.headers);
    expect(setupHeaders.get('Content-Type')).toBe('application/json');
    expect(setupHeaders.get('X-CSRF-Token')).toBe('csrf-token');
    expect(setupHeaders.get('authorization')).toBe('Bearer browser-token');

    const otherHeaders = new Headers(otherCall[1]?.headers);
    expect(otherHeaders.get('Accept')).toBe('application/json');
    expect(otherHeaders.get('X-CSRF-Token')).toBeNull();
    expect(otherHeaders.get('authorization')).toBeNull();
  });

  it('restores fetch when connect fails', async () => {
    const fetchMock = createFetchMock();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf } = await loadModule();

    await expect(
      connectRealtimeWithCsrf(async () => {
        throw new Error('connect failed');
      })
    ).rejects.toThrow('connect failed');

    expect(globalThis.fetch).toBe(fetchMock);
  });

  it('restores the base fetch after overlapping realtime connects finish out of order', async () => {
    const fetchMock = createFetchMock();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf } = await loadModule();
    const firstStarted = createDeferred<void>();
    const secondStarted = createDeferred<void>();
    const firstConnect = createDeferred<void>();
    const secondConnect = createDeferred<void>();

    const firstPromise = connectRealtimeWithCsrf(async () => {
      firstStarted.resolve();
      await firstConnect.promise;
    });
    await firstStarted.promise;
    expect(globalThis.fetch).not.toBe(fetchMock);

    const secondPromise = connectRealtimeWithCsrf(async () => {
      secondStarted.resolve();
      await secondConnect.promise;
    });
    await secondStarted.promise;
    const activeFetch = globalThis.fetch;
    expect(activeFetch).not.toBe(fetchMock);

    firstConnect.resolve();
    await firstPromise;
    expect(globalThis.fetch).toBe(activeFetch);

    secondConnect.resolve();
    await secondPromise;
    expect(globalThis.fetch).toBe(fetchMock);

    await fetch(REALTIME_SETUP_ENDPOINT);
    const restoredCall = fetchMock.mock.calls.at(-1);
    if (!restoredCall) {
      throw new Error('Expected restored fetch call');
    }
    const restoredHeaders = new Headers(restoredCall[1]?.headers);
    expect(restoredHeaders.get('X-CSRF-Token')).toBeNull();
    expect(restoredHeaders.get('authorization')).toBeNull();
  });

  it('uses bearer auth when csrf is unavailable', async () => {
    getCsrfTokenMock.mockResolvedValue('');
    const fetchMock = createFetchMock();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf } = await loadModule();

    await connectRealtimeWithCsrf(async () => {
      await fetch(REALTIME_SETUP_ENDPOINT);
    });

    const setupCall = fetchMock.mock.calls[0];
    if (!setupCall) {
      throw new Error('Expected realtime fetch call');
    }
    const setupHeaders = new Headers(setupCall[1]?.headers);
    expect(setupHeaders.get('authorization')).toBe('Bearer browser-token');
    expect(setupHeaders.get('X-CSRF-Token')).toBeNull();
  });

  it('does not attach realtime auth headers to off-origin setup-shaped requests', async () => {
    const fetchMock = createFetchMock();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf } = await loadModule();

    await connectRealtimeWithCsrf(async () => {
      await fetch(`https://attacker.example${REALTIME_SETUP_ENDPOINT}`);
    });

    const setupCall = fetchMock.mock.calls[0];
    if (!setupCall) {
      throw new Error('Expected off-origin fetch call');
    }
    const setupHeaders = new Headers(setupCall[1]?.headers);
    expect(setupHeaders.get('authorization')).toBeNull();
    expect(setupHeaders.get('X-CSRF-Token')).toBeNull();
  });

  it('fails before connect when auth and csrf are unavailable', async () => {
    getCsrfTokenMock.mockResolvedValueOnce('');
    getStoredTokenMock.mockReturnValueOnce({ ok: false, error: 'NOT_FOUND' });
    const connect = vi.fn(async () => {});
    const { connectRealtimeWithCsrf } = await loadModule();

    await expect(connectRealtimeWithCsrf(connect)).rejects.toThrow(
      'Sign in to use realtime voice.'
    );

    expect(connect).not.toHaveBeenCalled();
  });

  it('reuses a prewarmed realtime setup response for the matching SDK setup fetch', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockImplementation(async () =>
      Response.json({ token: 'prewarmed-token', tools: [] })
    );
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf, prewarmRealtimeVoiceSetup } = await loadModule();
    const sessionConfig = { outputModalities: ['audio' as const] };
    const setupBody = JSON.stringify({ sessionConfig });
    let setupPayload: unknown = null;

    prewarmRealtimeVoiceSetup(sessionConfig);
    await connectRealtimeWithCsrf(
      async () => {
        const response = await fetch(REALTIME_SETUP_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: setupBody,
        });
        setupPayload = await response.json();
      },
      { setupBody }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setupPayload).toEqual({ token: 'prewarmed-token', tools: [] });
    const prewarmCall = fetchMock.mock.calls[0];
    if (!prewarmCall) {
      throw new Error('Expected prewarm fetch call');
    }
    expect(prewarmCall[0]).toBe(REALTIME_SETUP_ENDPOINT);
    expect(prewarmCall[1]?.body).toBe(setupBody);
    const prewarmHeaders = new Headers(prewarmCall[1]?.headers);
    expect(prewarmHeaders.get('X-CSRF-Token')).toBe('csrf-token');
    expect(prewarmHeaders.get('authorization')).toBe('Bearer browser-token');
  });

  it('does not reuse a prewarmed realtime setup response after auth changes', async () => {
    const fetchMock = createFetchMock();
    fetchMock
      .mockResolvedValueOnce(Response.json({ token: 'prewarmed-token', tools: [] }))
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf, prewarmRealtimeVoiceSetup } = await loadModule();
    const sessionConfig = { outputModalities: ['audio' as const] };
    const setupBody = JSON.stringify({ sessionConfig });
    const setupResult: { status: number | null } = { status: null };
    getStoredTokenMock
      .mockReturnValueOnce({ ok: true, value: 'browser-token-before-logout' })
      .mockReturnValue({ ok: false, error: 'NOT_FOUND' });

    prewarmRealtimeVoiceSetup(sessionConfig);
    await connectRealtimeWithCsrf(
      async () => {
        const response = await fetch(REALTIME_SETUP_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: setupBody,
        });
        setupResult.status = response.status;
      },
      { setupBody }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setupResult.status).toBe(401);
    const liveSetupCall = fetchMock.mock.calls[1];
    if (!liveSetupCall) {
      throw new Error('Expected live realtime setup fetch after auth changed');
    }
    expect(liveSetupCall[0]).toBe(REALTIME_SETUP_ENDPOINT);
    const liveHeaders = new Headers(liveSetupCall[1]?.headers);
    expect(liveHeaders.get('X-CSRF-Token')).toBe('csrf-token');
    expect(liveHeaders.get('authorization')).toBeNull();
  });

  it('resolves optimistic browser realtime setup as an active connecting session', async () => {
    const { resolveRealtimeVoiceActivity } = await loadModule();

    expect(
      resolveRealtimeVoiceActivity({
        isConnectionStarting: true,
        realtimeStatus: 'disconnected',
      })
    ).toEqual({
      isActive: true,
      status: 'connecting',
    });
    expect(
      resolveRealtimeVoiceActivity({
        isConnectionStarting: false,
        realtimeStatus: 'disconnected',
      })
    ).toEqual({
      isActive: false,
      status: 'disconnected',
    });
    expect(
      resolveRealtimeVoiceActivity({
        isCapturing: true,
        isConnectionStarting: false,
        realtimeStatus: 'connecting',
      })
    ).toEqual({
      isActive: true,
      status: 'connected',
    });
    expect(
      resolveRealtimeVoiceActivity({
        isConnectionStarting: false,
        realtimeStatus: 'connected',
      })
    ).toEqual({
      isActive: true,
      status: 'connected',
    });
  });

  it('keeps AI SDK realtime identity inputs stable across startup rerenders', async () => {
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
    const initialOptions = experimentalUseRealtimeMock.mock.calls.at(-1)?.[0] as {
      api: unknown;
      model: unknown;
      sessionConfig: unknown;
    };
    let connectPromise: Promise<void>;
    await act(async () => {
      connectPromise = result.current.connect();
      await Promise.resolve();
    });
    const startupOptions = experimentalUseRealtimeMock.mock.calls.at(-1)?.[0] as {
      api: unknown;
      model: unknown;
      sessionConfig: unknown;
    };

    expect(startupOptions.model).toBe(initialOptions.model);
    expect(startupOptions.api).toBe(initialOptions.api);
    expect(startupOptions.sessionConfig).toBe(initialOptions.sessionConfig);

    streamDeferred.resolve(stream);
    connectDeferred.resolve();
    await act(async () => {
      await connectPromise;
    });

    unmount();
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
