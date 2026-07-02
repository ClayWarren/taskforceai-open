import { useVoice } from '@taskforceai/voice';
import { MAX_SPEECH_TEXT_CHARS } from '@taskforceai/client-runtime';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentProps } from 'react';

import '../../../../../tests/setup/dom';
import { StreamingProvider } from '../../lib/providers/StreamingProvider';

const withCsrfMock = vi.fn();
const loggerErrorMock = vi.fn();
const usePlatformRuntimeMock = vi.fn(() => 'browser');
const useConversationStoreMock = vi.fn();
const useStorageAdapterMock = vi.fn();
const tauriInvokeMock = vi.fn();

vi.mock('@taskforceai/voice', () => ({
  isVoiceCancellationError: () => false,
  useVoice: vi.fn(),
}));

vi.mock('@taskforceai/contracts/auth/csrf', () => ({
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

vi.mock('../markdown/ChunkedMarkdown', () => ({
  default: ({ content }: any) => <div data-testid="markdown">{content}</div>,
}));

vi.mock('./SourcesSidebar', () => ({
  default: ({ isOpen, sources }: any) =>
    isOpen ? <div data-testid="sources-sidebar">Count: {sources.length}</div> : null,
}));

const { default: MessageBubble } = await import('./MessageBubble');

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

class MockAudio {
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

class MockAudioBufferSource {
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

class MockAudioContext {
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

describe('MessageBubble', () => {
  const mockVoiceManager = {
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
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;
  let elementScrollToMock: ReturnType<typeof vi.fn>;
  let scrollIntoViewSpy: { mockRestore: () => void } | null = null;
  let elementScrollToSpy: { mockRestore: () => void } | null = null;

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

    useVoice.mockReturnValue({
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

  const renderMessage = (
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

  const renderScrollableMessage = (
    scrollTop: number,
    scrollHeight = 1000,
    props: Partial<ComponentProps<typeof MessageBubble>> = {}
  ) => {
    const message = { content: 'Response', id: 'scroll-message' };
    return render(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
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

  it('renders user message', () => {
    renderMessage({ content: 'Hello', id: '1' }, { isUser: true });
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('renders bot message with markdown', () => {
    renderMessage({ id: '2' });
    expect(screen.getByTestId('markdown')).toBeTruthy();
    expect(screen.getByText('Response')).toBeTruthy();
  });

  it('renders AgentExecutionPanel for agent status messages', () => {
    renderMessage({
      content: 'Planning...',
      id: '3',
      isAgentStatus: true,
      agentStatuses: [{ status: 'PROCESSING', agent_id: 1 }],
    });
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('renders persisted execution metadata on final assistant messages', () => {
    renderMessage({
      content: 'Final answer',
      id: 'persisted-run',
      isAgentStatus: false,
      agentStatuses: [{ status: 'COMPLETED', agent_id: 1, model: 'GPT 5.5' }],
      toolEvents: [{ toolName: 'search_web', agentId: 1, status: 'completed' }],
    });

    expect(screen.getByRole('progressbar', { name: /overall agent progress/i })).toBeTruthy();
    expect(screen.getByTestId('markdown').textContent).toBe('Final answer');
  });

  it('renders generated file downloads below the assistant reply', () => {
    renderMessage({
      content: 'Created the chart.',
      id: 'generated-file-reply',
      isAgentStatus: false,
      agentStatuses: [{ status: 'COMPLETED', agent_id: 1, model: 'GPT 5.5' }],
      toolEvents: [
        {
          agentId: 0,
          agentLabel: 'Agent 1',
          toolName: 'create_chart',
          arguments: { filePath: 'sunlight-planets.png' },
          success: true,
          durationMs: 220,
          generatedFile: {
            filename: 'sunlight-planets.png',
            mimeType: 'image/png',
            bytes: 2048,
            fileId: 'file-generated',
            artifactId: 'artifact-generated',
            downloadUrl: '/api/v1/developer/files/file-generated/content',
          },
        },
      ],
    });

    const openLink = screen.getByRole('link', { name: 'Open sunlight-planets.png' });
    const downloadLink = screen.getByRole('link', { name: 'Download sunlight-planets.png' });

    expect(screen.getByTestId('markdown').textContent).toBe('Created the chart.');
    expect(screen.getByText('sunlight-planets.png')).toBeTruthy();
    expect(screen.getByText('image/png · 2.0 KB')).toBeTruthy();
    expect(openLink).toHaveAttribute('href', '/artifacts/artifact-generated');
    expect(downloadLink).toHaveAttribute('href', '/api/v1/developer/files/file-generated/content');
    expect(downloadLink).toHaveAttribute('download', 'sunlight-planets.png');
  });

  it('does not render generated file download anchors for unsafe URLs', () => {
    renderMessage({
      content: 'Created the chart.',
      id: 'unsafe-generated-file-reply',
      isAgentStatus: false,
      toolEvents: [
        {
          toolName: 'create_chart',
          generatedFile: {
            filename: 'unsafe.png',
            mimeType: 'image/png',
            downloadUrl: 'javascript:alert(1)',
          },
        },
      ],
    });

    expect(screen.getByText('unsafe.png')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Download unsafe.png' })).toBeNull();
  });

  it('renders local command output without assistant message actions', () => {
    renderMessage({
      content: 'Status\napp-server: local',
      id: 'local-command',
      isLocalCommandOutput: true,
    });

    expect(screen.getByTestId('markdown').textContent).toBe('Status\napp-server: local');
    expect(screen.queryByTitle('Copy response')).toBeNull();
    expect(screen.queryByTitle('Listen to response')).toBeNull();
    expect(screen.queryByTitle('Helpful')).toBeNull();
    expect(screen.queryByTitle('Not helpful')).toBeNull();
  });

  it('handles voice speaking toggle', async () => {
    renderMessage({ content: 'Hello world', id: '4' });

    const listenBtn = screen.getByText('Listen');
    fireEvent.click(listenBtn);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/speech/generate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: 'Hello world' }),
        })
      );
      expect(MockAudio.instances[0]?.play).toHaveBeenCalled();
    });
    expect(MockAudio.instances[0]?.src).toBe('blob:speech-audio');
  });

  it('starts read aloud playback from the first chunk while prefetching the next chunk', async () => {
    const firstChunk = 'First chunk sentence. '.repeat(36).trim();
    const secondChunk = 'Second chunk sentence. '.repeat(60).trim();
    renderMessage({ content: `${firstChunk}\n\n${secondChunk}`, id: '4-chunked-speech' });

    fireEvent.click(screen.getByText('Listen'));

    await waitFor(() => {
      const speechCalls = (
        globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.filter((call) => requestUrl(call[0]).endsWith('/api/speech/generate'));
      expect(speechCalls).toHaveLength(2);
      expect(MockAudio.instances[0]?.play).toHaveBeenCalled();
    });

    const speechCalls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => requestUrl(call[0]).endsWith('/api/speech/generate')
    );
    const firstPayload = JSON.parse(String(speechCalls[0]?.[1]?.body)) as { text: string };
    const secondPayload = JSON.parse(String(speechCalls[1]?.[1]?.body)) as { text: string };
    expect(firstPayload.text).toBe(firstChunk);
    expect(secondPayload.text).toBe(secondChunk);
  });

  it('plays generated speech through an unlocked AudioContext when available', async () => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext,
    });
    renderMessage({ content: 'Hello audio context', id: '4-audio-context' });

    fireEvent.click(screen.getByText('Listen'));

    await waitFor(() => {
      const audioContext = MockAudioContext.instances[0];
      const source = MockAudioBufferSource.instances[0];

      expect(audioContext?.resume).toHaveBeenCalled();
      expect(audioContext?.decodeAudioData).toHaveBeenCalled();
      expect(source?.connect).toHaveBeenCalledWith(audioContext?.destination);
      expect(source?.start).toHaveBeenCalled();
    });
    expect(MockAudio.instances).toHaveLength(0);
  });

  it('keeps generated speech requests within the server text limit', async () => {
    const longContent = `${'word '.repeat(Math.ceil(MAX_SPEECH_TEXT_CHARS / 5) + 40)}done`;
    renderMessage({ content: longContent, id: '4-long-speech' });

    fireEvent.click(screen.getByText('Listen'));

    await waitFor(() => {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const speechCall = fetchMock.mock.calls.find((call) =>
        requestUrl(call[0]).endsWith('/api/speech/generate')
      );
      expect(speechCall).toBeDefined();
      const payload = JSON.parse(String(speechCall?.[1]?.body)) as { text: string };
      expect(payload.text.length).toBeLessThanOrEqual(MAX_SPEECH_TEXT_CHARS);
      expect(payload.text.startsWith('word ')).toBe(true);
      expect(MockAudio.instances[0]?.play).toHaveBeenCalled();
    });
  });

  it('renders sources button and opens modal', async () => {
    renderMessage({
      content: 'I found this',
      id: '5',
      sources: [{ url: 'http://test.com', title: 'Test' }],
    });

    const sourcesBtn = screen.getByText(/1 source/i);
    expect(sourcesBtn).toBeTruthy();

    fireEvent.click(sourcesBtn);
    expect(await screen.findByTestId('sources-sidebar')).toBeTruthy();
    expect(await screen.findByText('Count: 1')).toBeTruthy();
  });

  it('restores sources from persisted tool events when message sources are missing', async () => {
    renderMessage({
      content: 'I found this after refresh',
      id: '5a',
      toolEvents: [
        {
          agentId: 0,
          agentLabel: 'AGENT 1',
          toolName: 'search_web',
          arguments: { query: 'latest AI news' },
          success: true,
          durationMs: 250,
          sources: [{ url: 'https://news.example/story', title: 'News Story' }],
        },
      ],
    });

    const sourcesBtn = screen.getByText(/1 source/i);
    expect(sourcesBtn).toBeTruthy();

    fireEvent.click(sourcesBtn);
    expect(await screen.findByTestId('sources-sidebar')).toBeTruthy();
    expect(await screen.findByText('Count: 1')).toBeTruthy();
  });

  it('pluralizes source counts and opens sources with the latest message sources', async () => {
    const message = {
      content: 'I found more',
      id: '5b',
      sources: [
        { url: 'http://one.test', title: 'One' },
        { url: 'http://two.test', title: 'Two' },
      ],
    };
    const { rerender } = renderMessage(message);

    expect(screen.getByText(/2 sources/i)).toBeTruthy();

    rerender(
      <MessageBubble
        message={
          {
            ...message,
            sources: [
              { url: 'http://one.test', title: 'One' },
              { url: 'http://two.test', title: 'Two' },
              { url: 'http://three.test', title: 'Three' },
            ],
          } as any
        }
        isUser={false}
      />
    );

    fireEvent.click(screen.getByText(/3 sources/i));
    expect(await screen.findByText('Count: 3')).toBeTruthy();
  });

  it('renders user timestamp if provided', () => {
    const timestamp = new Date(2025, 0, 1, 12, 0).toISOString();
    renderMessage({ content: 'Hi', id: '6' }, { isUser: true, timestamp });
    expect(screen.getByText(/12:00/)).toBeTruthy();
  });

  it('renders realtime voice user messages as tight right-aligned bubbles with hover copy', () => {
    const timestamp = new Date(2025, 0, 1, 12, 0).toISOString();
    renderMessage(
      { content: 'Just to hear me.', id: 'realtime-voice-user-1' },
      { isUser: true, timestamp }
    );

    const content = screen.getByText('Just to hear me.');
    const messageBubble = content.closest('.message-bubble') as HTMLElement | null;
    const bubble = content.closest('.message-content')?.parentElement as HTMLElement | null;
    expect(bubble?.style.width).toBe('fit-content');
    expect(bubble?.style.maxWidth).toBe('min(32rem, 78%)');
    expect(messageBubble?.style.scrollMarginBlockEnd).toBe(
      'var(--realtime-voice-transcript-bottom-offset, 0px)'
    );
    expect(screen.queryByText(/12:00/)).toBeNull();

    const copyButton = screen.getByTitle('Copy message');
    expect(copyButton.textContent).toBe('');
    expect(copyButton.parentElement?.className).toContain('opacity-0');
  });

  it('renders assistant reply time in the action row', () => {
    const createdAt = new Date(2025, 0, 1, 12, 34).getTime();
    renderMessage({ content: 'Timed response', id: '6b', createdAt });

    expect(screen.getByText(/12:34/)).toBeTruthy();
  });

  it('renders realtime voice assistant actions as icon-only controls with time in overflow', () => {
    const createdAt = new Date(2025, 0, 1, 12, 34).getTime();
    renderMessage({
      content: "Got it-I'm here to listen. What's on your mind?",
      id: 'realtime-voice-assistant-1',
      createdAt,
    });

    const copyButton = screen.getByTitle('Copy response');
    expect(copyButton.textContent).toBe('');
    expect(screen.queryByTitle('Listen to response')).toBeNull();
    expect(screen.queryByText('Listen')).toBeNull();
    expect(screen.queryByText(/12:34/)).toBeNull();

    fireEvent.click(screen.getByTitle('More options'));

    expect(screen.getByText(/12:34/)).toBeTruthy();
  });

  it('omits assistant reply time for invalid timestamps', () => {
    renderMessage({ content: 'Untimed response', id: '6c', createdAt: Number.NaN });

    expect(screen.queryByText(/Invalid/)).toBeNull();
  });

  it('syncs feedback button state when message rating prop changes', () => {
    const message = { content: 'Rated', id: '7', rating: 0 };
    const { rerender } = renderMessage(message);
    const helpfulButton = screen.getByTitle('Helpful');
    expect(helpfulButton.className).not.toContain('text-emerald-500');

    rerender(
      <StreamingProvider>
        <MessageBubble message={{ ...message, rating: 1 } as any} isUser={false} />
      </StreamingProvider>
    );
    expect(screen.getByTitle('Helpful').className).toContain('text-emerald-500');
  });

  it('adds CSRF headers when submitting feedback', async () => {
    renderMessage({ content: 'Rated', id: '10', rating: 0 });

    fireEvent.click(screen.getByTitle('Helpful'));

    await waitFor(() => {
      expect(withCsrfMock).toHaveBeenCalledWith({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 1 }),
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/messages/10/feedback',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rating: 1 }),
        })
      );
    });
  });

  it('toggles negative feedback and restores the previous rating when submit fails', async () => {
    globalThis.fetch = vi.fn(
      async () => ({ ok: false, statusText: 'Bad Request' }) as Response
    ) as unknown as typeof fetch;
    renderMessage({ content: 'Rated', id: '11', rating: 0 });

    fireEvent.click(screen.getByTitle('Not helpful'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/messages/11/feedback',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rating: -1 }),
        })
      );
      expect(screen.getByTitle('Not helpful').className).not.toContain('text-rose-500');
    });
  });

  it('silently restores feedback state when the server cannot rate an unsynced message', async () => {
    globalThis.fetch = vi.fn(
      async () => ({ ok: false, status: 403, statusText: 'Forbidden' }) as Response
    ) as unknown as typeof fetch;
    renderMessage({ content: 'Rated', id: 'assistant-local', rating: 0 });

    fireEvent.click(screen.getByTitle('Helpful'));

    await waitFor(() => {
      expect(screen.getByTitle('Helpful').className).not.toContain('text-emerald-500');
      expect(loggerErrorMock).not.toHaveBeenCalled();
    });
  });

  it('clears an existing positive rating when clicked again', async () => {
    renderMessage({ content: 'Rated', id: '12', rating: 1 });

    fireEvent.click(screen.getByLabelText('Rated positive'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/messages/12/feedback',
        expect.objectContaining({
          body: JSON.stringify({ rating: 0 }),
        })
      );
    });
  });

  it('encodes message ids in feedback endpoint paths', async () => {
    renderMessage({ content: 'Rated', id: '../task-1', rating: 0 });

    fireEvent.click(screen.getByTitle('Helpful'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/messages/..%2Ftask-1/feedback',
        expect.anything()
      );
    });
  });

  it('auto-scrolls when user is near the bottom', () => {
    const { rerender } = renderScrollableMessage(340);

    expect(elementScrollToMock).toHaveBeenCalledTimes(1);
    expect(elementScrollToMock).toHaveBeenLastCalledWith({
      top: 244,
      behavior: 'auto',
    });

    rerender(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 1000 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 340, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <MessageBubble
          message={{ content: 'Updated response', id: 'scroll-message' } as any}
          isUser={false}
        />
      </div>
    );

    expect(elementScrollToMock).toHaveBeenCalledTimes(2);
    expect(elementScrollToMock).toHaveBeenLastCalledWith({
      top: 244,
      behavior: 'auto',
    });
  });

  it('keeps streaming assistant messages tail-aligned while content arrives', () => {
    render(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 1000 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 340, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <MessageBubble
          message={
            { content: 'Streaming response', id: 'streaming-message', isStreaming: true } as any
          }
          isUser={false}
        />
      </div>
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({
      behavior: 'smooth',
      block: 'end',
    });
  });

  it('keeps latest realtime voice user transcripts tail-aligned while content arrives', () => {
    const { rerender } = render(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 1800 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 200, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <MessageBubble
          message={{ content: 'This is live', id: 'realtime-voice-user-1' } as any}
          isLatestMessage
          isUser
        />
      </div>
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({
      behavior: 'auto',
      block: 'end',
    });

    rerender(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 1900 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 200, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <MessageBubble
          message={
            { content: 'This is live and still growing', id: 'realtime-voice-user-1' } as any
          }
          isLatestMessage
          isUser
        />
      </div>
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({
      behavior: 'auto',
      block: 'end',
    });
  });

  it('does not auto-scroll when user is reading older messages', () => {
    const { rerender } = renderScrollableMessage(200, 1800);

    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    rerender(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 1800 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 200, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <MessageBubble
          message={{ content: 'Updated response', id: 'scroll-message' } as any}
          isUser={false}
        />
      </div>
    );

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('anchors the latest completed assistant reply even after a large content jump', () => {
    renderScrollableMessage(200, 4000, { isLatestMessage: true });

    expect(elementScrollToMock).toHaveBeenCalledTimes(1);
    expect(elementScrollToMock).toHaveBeenLastCalledWith({
      top: 104,
      behavior: 'auto',
    });
  });

  it('anchors a latest assistant reply when a streaming message completes', () => {
    const message = {
      content: 'Streaming response',
      id: 'streaming-to-complete-message',
      isStreaming: true,
    };
    const { rerender } = render(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 4000 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 200, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <StreamingProvider>
          <MessageBubble message={message as any} isUser={false} isLatestMessage />
        </StreamingProvider>
      </div>
    );

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(elementScrollToMock).not.toHaveBeenCalled();

    rerender(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 4000 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 200, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <StreamingProvider>
          <MessageBubble
            message={{ ...message, isStreaming: false } as any}
            isUser={false}
            isLatestMessage
          />
        </StreamingProvider>
      </div>
    );

    expect(elementScrollToMock).toHaveBeenCalledTimes(1);
    expect(elementScrollToMock).toHaveBeenLastCalledWith({
      top: 104,
      behavior: 'auto',
    });
  });

  it('renders multiline user messages and copies them', async () => {
    renderMessage({ content: 'Line one\nLine two', id: '13' }, { isUser: true });

    fireEvent.click(screen.getByTitle('Copy message'));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Line one\nLine two');
      expect(screen.getByText('Copied')).toBeTruthy();
    });
  });

  it('copies bot responses and invokes share callbacks', async () => {
    const onShare = vi.fn();
    renderMessage({ content: 'Shareable response', id: '14' }, { canShare: true, onShare });

    fireEvent.click(screen.getByTitle('Copy response'));
    fireEvent.click(screen.getByTitle('Share conversation'));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Shareable response');
      expect(screen.getByText('Copied')).toBeTruthy();
    });
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('does not render empty assistant messages', () => {
    const { container } = render(
      <MessageBubble message={{ content: '   ', id: '15' } as any} isUser={false} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('does not speak blank assistant content', () => {
    renderMessage({
      content: '   ',
      id: '16',
      toolEvents: [
        {
          toolName: 'create_chart',
          generatedFile: {
            filename: 'chart.png',
            mimeType: 'image/png',
            downloadUrl: '/api/file',
          },
        },
      ],
    });

    fireEvent.click(screen.getByTitle('Listen to response'));

    expect(screen.getByTitle('Listen to response')).toHaveAttribute('disabled');
    expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/speech/generate', expect.anything());
  });

  it('uses app-server speech generation in desktop runtime without exposing bearer auth', async () => {
    usePlatformRuntimeMock.mockReturnValue('desktop');
    renderMessage({ content: 'Hello desktop', id: '16b' });

    fireEvent.click(screen.getByText('Listen'));

    await waitFor(() => {
      expect(tauriInvokeMock).toHaveBeenCalledWith('app_server_voice_speech_generate', {
        params: { text: 'Hello desktop' },
      });
      expect(MockAudio.instances[0]?.play).toHaveBeenCalled();
    });
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      'https://www.taskforceai.chat/api/speech/generate',
      expect.anything()
    );
    expect(mockVoiceManager.speak).not.toHaveBeenCalled();
  });

  it('stops active speech when the listen button is clicked during playback', async () => {
    renderMessage({ content: 'Long response', id: '17' });

    fireEvent.click(screen.getByText('Listen'));
    await waitFor(() => expect(screen.getByText('Stop')).toBeTruthy());

    fireEvent.click(screen.getByText('Stop'));

    await waitFor(() => {
      expect(MockAudio.instances[0]?.pause).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:speech-audio');
    });
  });

  it('logs and resets state when speech fails', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input).endsWith('/api/speech/generate')) {
        return Response.json({ error: 'Speech generation failed' }, { status: 502 });
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    renderMessage({ content: 'Speak me', id: '18' });

    fireEvent.click(screen.getByText('Listen'));

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(
        'Failed to speak message',
        expect.objectContaining({ error: expect.any(Error) })
      );
      expect(screen.getByText('Listen')).toBeTruthy();
    });
  });

  it('logs when stopping speech fails', async () => {
    renderMessage({ content: 'Stop me', id: '19' });

    fireEvent.click(screen.getByText('Listen'));
    await waitFor(() => expect(screen.getByText('Stop')).toBeTruthy());
    MockAudio.instances[0]?.pause.mockImplementationOnce(() => {
      throw new Error('stop failed');
    });

    fireEvent.click(screen.getByText('Stop'));

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(
        'Failed to stop generated speech playback',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });

  it('logs when copying a message fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error('clipboard denied');
        }),
      },
    });

    renderMessage({ content: 'Copy fail', id: '20' }, { isUser: true });
    fireEvent.click(screen.getByTitle('Copy message'));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copy fail');
      expect(screen.queryByText('Copied')).toBeNull();
    });
  });

  it('ignores opening sources when no sources are available', () => {
    renderMessage({ content: 'No sources', id: '21' });
    expect(screen.queryByTestId('sources')).toBeNull();
    expect(screen.queryByTestId('sources-sidebar')).toBeNull();
  });

  it('cleans up voice playback on unmount', async () => {
    mockVoiceManager.cancel.mockResolvedValueOnce(undefined);
    const { unmount } = renderMessage({ content: 'Unmount me', id: '22' });

    fireEvent.click(screen.getByText('Listen'));
    await waitFor(() => expect(screen.getByText('Stop')).toBeTruthy());

    unmount();

    await waitFor(() => {
      expect(MockAudio.instances[0]?.pause).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:speech-audio');
      expect(mockVoiceManager.cancel).toHaveBeenCalled();
    });
  });
});
