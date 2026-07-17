import { vi } from 'bun:test';

import { REALTIME_INPUT_SAMPLE_RATE } from '@taskforceai/client-runtime';

export const getCsrfTokenMock = vi.fn();
export const getStoredTokenMock = vi.fn();
export const experimentalUseRealtimeMock = vi.fn();
export const useDesktopRealtimeVoiceSessionMock = vi.fn(() => ({
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
export const loggerErrorMock = vi.fn();
export const loggerDebugMock = vi.fn();
export const usePlatformRuntimeMock = vi.fn(() => 'browser');

void vi.mock('@taskforceai/api-client/auth/auth-storage', () => ({
  getStoredToken: getStoredTokenMock,
}));

void vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  getCsrfToken: getCsrfTokenMock,
}));

void vi.mock('@ai-sdk/react', () => ({
  experimental_useRealtime: experimentalUseRealtimeMock,
}));

void vi.mock('../../../../lib/logger', () => ({
  logger: {
    debug: loggerDebugMock,
    error: loggerErrorMock,
  },
}));

void vi.mock('../../../../lib/platform/PlatformProvider', () => ({
  usePlatformRuntime: usePlatformRuntimeMock,
}));

void vi.mock('../../../../lib/platform/desktop-ui', () => ({
  useDesktopRealtimeVoiceSession: useDesktopRealtimeVoiceSessionMock,
}));

export const loadModule = async () => import('./useRealtimeVoiceSession');

export const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

const createRealtimeSessionDefaults = () => ({
  addToolOutput: vi.fn(),
  cancelResponse: vi.fn(),
  clearAudioBuffer: vi.fn(),
  commitAudio: vi.fn(),
  connect: vi.fn(async (): Promise<void> => {}),
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
});

export const createRealtimeSessionFixture = (
  overrides: Partial<ReturnType<typeof createRealtimeSessionDefaults>> = {}
) => ({
  ...createRealtimeSessionDefaults(),
  ...overrides,
});

export class MockMediaStreamAudioSourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

export class MockAudioWorklet {
  addModule = vi.fn(async () => undefined);
}

export class MockAudioContext {
  static instances: MockAudioContext[] = [];

  audioWorklet: MockAudioWorklet | undefined = new MockAudioWorklet();
  currentTime = 0;
  destination = {};
  sampleRate = REALTIME_INPUT_SAMPLE_RATE;
  close = vi.fn(async () => undefined);
  createMediaStreamSource = vi.fn(() => new MockMediaStreamAudioSourceNode());

  constructor(options?: AudioContextOptions) {
    this.sampleRate = options?.sampleRate ?? REALTIME_INPUT_SAMPLE_RATE;
    MockAudioContext.instances.push(this);
  }
}

export class MockMessagePort {
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

export class MockAudioWorkletNode {
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

const restoreProperty = (
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined
) => {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
};

export const installRealtimeBrowserTestEnvironment = (): (() => void) => {
  const originalFetch = globalThis.fetch;
  const originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  const originalAudioContextDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext');
  const originalAudioWorkletNodeDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'AudioWorkletNode'
  );
  const originalCreateObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const originalRevokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

  MockAudioContext.instances = [];
  MockAudioWorkletNode.instances = [];
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

  return () => {
    globalThis.fetch = originalFetch;
    restoreProperty(navigator, 'mediaDevices', originalMediaDevicesDescriptor);
    restoreProperty(window, 'AudioContext', originalAudioContextDescriptor);
    restoreProperty(globalThis, 'AudioWorkletNode', originalAudioWorkletNodeDescriptor);
    restoreProperty(URL, 'createObjectURL', originalCreateObjectURLDescriptor);
    restoreProperty(URL, 'revokeObjectURL', originalRevokeObjectURLDescriptor);
  };
};

export type FetchTestMock = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
> &
  typeof fetch;

export const createFetchMock = (): FetchTestMock => {
  const mock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response('{}')
  );
  return Object.assign(mock, {
    preconnect: vi.fn<typeof globalThis.fetch.preconnect>(),
  }) as FetchTestMock;
};
