// oxlint-disable typescript/no-floating-promises -- Bun's vi.mock registration is intentionally synchronous at module setup.
import { useVoice } from '@taskforceai/react-core/useVoice';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, vi } from 'bun:test';
import type { ComponentProps } from 'react';

import '../../../../../tests/setup/dom';
import { StreamingProvider } from '../../lib/providers/StreamingProvider';

export const withCsrfMock = vi.fn();
export const loggerErrorMock = vi.fn();
export const usePlatformRuntimeMock = vi.fn(() => 'browser');
export const useConversationStoreMock = vi.fn();
export const useStorageAdapterMock = vi.fn();
export const tauriInvokeMock = vi.fn();

vi.mock('@taskforceai/react-core/useVoice', () => ({
  useVoice: vi.fn(),
}));

vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  getCsrfToken: vi.fn(async () => 'csrf-token'),
  withCsrf: withCsrfMock,
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('../../lib/platform/PlatformProvider', () => ({
  useConversationStore: useConversationStoreMock,
  usePlatformRuntime: usePlatformRuntimeMock,
  useStorageAdapter: useStorageAdapterMock,
}));

vi.mock('../../lib/platform/desktop-api', () => ({
  createVoiceGatewayRequestOptions: async (runtime: string) => {
    if (runtime !== 'desktop') return {};
    return {
      fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) => {
        const payload = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          text?: string;
        };
        const result = (await tauriInvokeMock('app_server_voice_speech_generate', {
          params: { text: payload.text ?? '' },
        })) as { mediaType?: string };
        return new Response('audio', {
          headers: { 'content-type': result.mediaType ?? 'audio/mpeg' },
          status: 200,
        });
      },
    };
  },
}));

vi.mock('../markdown/ChunkedMarkdown', () => ({
  default: ({ content }: any) => <div data-testid="markdown">{content}</div>,
}));

vi.mock('./SourcesSidebar', () => ({
  default: ({ isOpen, sources }: any) =>
    isOpen ? <div data-testid="sources-sidebar">Count: {sources.length}</div> : null,
}));

export let MessageBubble: (typeof import('./MessageBubble'))['default'];
export const useVoiceMock = useVoice as unknown as ReturnType<typeof vi.fn>;

export const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

export class MockAudio {
  static instances: MockAudio[] = [];

  src: string;
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') {
      this.src = '';
    }
  });

  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  constructor(src = '') {
    this.src = src;
    MockAudio.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') {
        listener(new Event(type));
      } else {
        listener.handleEvent(new Event(type));
      }
    }
  }
}

export class MockAudioBufferSource {
  static instances: MockAudioBufferSource[] = [];

  buffer: AudioBuffer | null = null;
  addEventListener = vi.fn();
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();

  constructor() {
    MockAudioBufferSource.instances.push(this);
  }
}

export class MockAudioContext {
  static instances: MockAudioContext[] = [];

  state: AudioContextState = 'suspended';
  destination = {};
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createBufferSource = vi.fn(() => new MockAudioBufferSource() as unknown as AudioBufferSourceNode);
  decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);
  resume = vi.fn(async () => {
    this.state = 'running';
  });

  constructor() {
    MockAudioContext.instances.push(this);
  }
}

export const mockVoiceManager = {
  init: vi.fn(),
  speak: vi.fn(),
  cancel: vi.fn(),
};
const originalFetch = globalThis.fetch;
const originalCreateObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const originalAudioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
const originalAudioContextDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext');
const originalWebkitAudioContextDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'webkitAudioContext'
);
const originalTauriDescriptor = Object.getOwnPropertyDescriptor(window, '__TAURI__');
export let scrollIntoViewMock: ReturnType<typeof vi.fn>;
export let elementScrollToMock: ReturnType<typeof vi.fn>;
let scrollIntoViewSpy: { mockRestore: () => void } | null = null;
let elementScrollToSpy: { mockRestore: () => void } | null = null;

export const installMessageBubbleHarness = () => {
  beforeAll(async () => {
    ({ default: MessageBubble } = await import('./MessageBubble'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    withCsrfMock.mockImplementation(async (init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('X-CSRF-Token', 'csrf-token');
      return { ...init, headers };
    });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input).endsWith('/api/speech/generate')) {
        return new Response(new Blob(['audio'], { type: 'audio/mpeg' }), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        });
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    scrollIntoViewMock = vi.fn();
    elementScrollToMock = vi.fn();
    scrollIntoViewSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(scrollIntoViewMock);
    elementScrollToSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollTo')
      .mockImplementation(elementScrollToMock);

    useVoiceMock.mockReturnValue({
      manager: mockVoiceManager,
      status: 'idle',
    });
    usePlatformRuntimeMock.mockReturnValue('browser');
    useConversationStoreMock.mockReturnValue({ enqueuePrompt: vi.fn() });
    useStorageAdapterMock.mockReturnValue({
      getItem: vi.fn(async () => null),
      removeItem: vi.fn(async () => undefined),
      setItem: vi.fn(async () => undefined),
    });
    tauriInvokeMock.mockImplementation(async (command: string) => {
      if (command === 'app_server_auth_status') {
        return {
          authenticated: true,
        };
      }
      if (command === 'app_server_voice_speech_generate') {
        return {
          audioBase64: 'YXVkaW8=',
          mediaType: 'audio/mpeg',
          format: 'mp3',
        };
      }
      return undefined;
    });
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: {
        invoke: tauriInvokeMock,
      },
    });
    MockAudio.instances = [];
    MockAudioContext.instances = [];
    MockAudioBufferSource.instances = [];
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:speech-audio'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(globalThis, 'Audio', {
      configurable: true,
      value: MockAudio,
    });

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });
  });

  afterEach(() => {
    cleanup();
    scrollIntoViewSpy?.mockRestore();
    scrollIntoViewSpy = null;
    elementScrollToSpy?.mockRestore();
    elementScrollToSpy = null;
    globalThis.fetch = originalFetch;
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
    if (originalAudioDescriptor) {
      Object.defineProperty(globalThis, 'Audio', originalAudioDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'Audio');
    }
    if (originalAudioContextDescriptor) {
      Object.defineProperty(window, 'AudioContext', originalAudioContextDescriptor);
    } else {
      Reflect.deleteProperty(window, 'AudioContext');
    }
    if (originalWebkitAudioContextDescriptor) {
      Object.defineProperty(window, 'webkitAudioContext', originalWebkitAudioContextDescriptor);
    } else {
      Reflect.deleteProperty(window, 'webkitAudioContext');
    }
    if (originalTauriDescriptor) {
      Object.defineProperty(window, '__TAURI__', originalTauriDescriptor);
    } else {
      Reflect.deleteProperty(window, '__TAURI__');
    }
  });
};

export const renderMessage = (
  message: Record<string, unknown>,
  props: Partial<ComponentProps<typeof MessageBubble>> = {}
) =>
  render(
    <StreamingProvider>
      <MessageBubble
        message={{ content: 'Response', id: 'message-1', ...message } as any}
        isUser={false}
        {...props}
      />
    </StreamingProvider>
  );

export const renderScrollableMessage = (
  scrollTop: number,
  scrollHeight = 1000,
  props: Partial<ComponentProps<typeof MessageBubble>> = {}
) => {
  const message = { content: 'Response', id: 'scroll-message' };
  return render(
    <div
      ref={(node) => {
        if (!node) return;
        Object.defineProperties(node, {
          scrollHeight: { configurable: true, value: scrollHeight },
          clientHeight: { configurable: true, value: 600 },
          scrollTop: { configurable: true, value: scrollTop, writable: true },
        });
      }}
      style={{ overflowY: 'auto' }}
    >
      <StreamingProvider>
        <MessageBubble message={message as any} isUser={false} {...props} />
      </StreamingProvider>
    </div>
  );
};
