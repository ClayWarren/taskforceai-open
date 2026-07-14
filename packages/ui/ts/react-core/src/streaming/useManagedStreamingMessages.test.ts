import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../../tests/setup/dom';

import {
  patchManagedStreamingStatusMessage,
  useManagedStreamingMessages,
  type ManagedStreamingPersistence,
} from './useManagedStreamingMessages';

type TestMessage = {
  id: string;
  role: 'assistant';
  content: string;
  isStreaming: boolean;
  isAgentStatus?: boolean;
  sources?: string[];
  toolEvents?: string[];
  agentStatuses?: string[];
  elapsedSeconds?: number;
  pendingApproval?: string;
  error?: string | null;
  trace_id?: string;
};

type TestPersistence = ManagedStreamingPersistence<string, string, string, string>;

let idCounter = 0;

vi.mock('@taskforceai/client-runtime/id', () => ({
  createId: (prefix: string) => {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
  },
}));

const createPlaceholders = ({
  statusMessageId,
  contentMessageId,
}: {
  statusMessageId: string;
  contentMessageId: string;
}) => ({
  statusPlaceholder: {
    id: statusMessageId,
    role: 'assistant' as const,
    content: '',
    isStreaming: true,
    isAgentStatus: true,
    sources: [],
    toolEvents: [],
    agentStatuses: [],
  },
  contentPlaceholder: {
    id: contentMessageId,
    role: 'assistant' as const,
    content: '',
    isStreaming: true,
    isAgentStatus: false,
    sources: [],
    toolEvents: [],
    agentStatuses: [],
  },
});

const createPersistence = (overrides: Partial<TestPersistence> = {}): TestPersistence => ({
  persistPlaceholderPair: vi.fn().mockResolvedValue(undefined),
  rollbackPlaceholderPair: vi.fn().mockResolvedValue(undefined),
  persistLiveContent: vi.fn().mockResolvedValue(undefined),
  persistLiveStatus: vi.fn().mockResolvedValue(undefined),
  persistToolEvents: vi.fn().mockResolvedValue(undefined),
  persistAgentStatuses: vi.fn().mockResolvedValue(undefined),
  flushBeforeFinalState: vi.fn().mockResolvedValue(undefined),
  flushBeforeErrorState: vi.fn().mockResolvedValue(undefined),
  persistFinalState: vi.fn().mockResolvedValue(undefined),
  persistErrorState: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

type HookOptions = Parameters<
  typeof useManagedStreamingMessages<TestMessage, string, string, string, string>
>[0];

const createOptions = (overrides: Partial<HookOptions> = {}): HookOptions => ({
  isStreaming: true,
  streamContent: '',
  finalResponse: null,
  errorMessage: null,
  conversationId: 'conversation-1',
  ensureActiveConversation: vi.fn().mockResolvedValue('conversation-1'),
  setMessages: vi.fn(),
  sources: [],
  finalSources: [],
  toolEvents: [],
  finalToolEvents: [],
  elapsedSeconds: 0,
  agentStatuses: [],
  pendingApproval: null,
  traceId: null,
  finalizeFrom: 'prop',
  createPlaceholders,
  persistence: createPersistence(),
  logger: { debug: vi.fn(), error: vi.fn() },
  ...overrides,
});

const renderManagedStreamingHook = (initialOptions: HookOptions) =>
  renderHook(
    (options: HookOptions) => {
      const [messages, setMessages] = React.useState<TestMessage[]>([]);
      const streamingState = useManagedStreamingMessages<
        TestMessage,
        string,
        string,
        string,
        string
      >({
        ...options,
        setMessages,
      });
      return { messages, streamingState };
    },
    { initialProps: initialOptions }
  );

describe('useManagedStreamingMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    idCounter = 0;
  });

  describe('patchManagedStreamingStatusMessage', () => {
    it('patches the matching status message without rewriting unrelated messages', () => {
      const messages: TestMessage[] = [
        {
          id: 'other',
          role: 'assistant',
          content: 'unchanged',
          isStreaming: false,
        },
        {
          id: 'status',
          role: 'assistant',
          content: '',
          isStreaming: true,
          isAgentStatus: true,
          toolEvents: [],
          agentStatuses: [],
        },
      ];

      const next = patchManagedStreamingStatusMessage<TestMessage, string, string>(
        messages,
        'status',
        {
          elapsedSeconds: 12,
          toolEvents: ['tool-live'],
          agentStatuses: ['agent-live'],
          pendingApproval: null,
          requireAgentStatus: true,
        }
      );

      const statusMessage = messages[1]!;
      expect(next).not.toBe(messages);
      expect(next[0]).toBe(messages[0]);
      expect(next[1]).toEqual({
        ...statusMessage,
        elapsedSeconds: 12,
        toolEvents: ['tool-live'],
        agentStatuses: ['agent-live'],
        pendingApproval: undefined,
      });
    });

    it('returns the original array when the status message is missing or not an agent row', () => {
      const messages: TestMessage[] = [
        {
          id: 'content',
          role: 'assistant',
          content: 'streaming',
          isStreaming: true,
          isAgentStatus: false,
        },
      ];

      expect(
        patchManagedStreamingStatusMessage<TestMessage, string, string>(messages, 'missing', {
          toolEvents: ['tool-live'],
        })
      ).toBe(messages);
      expect(
        patchManagedStreamingStatusMessage<TestMessage, string, string>(messages, 'content', {
          agentStatuses: ['agent-live'],
          requireAgentStatus: true,
        })
      ).toBe(messages);
    });
  });

  it('creates placeholders and persists buffered live content, status, tools, and agents', async () => {
    const persistence = createPersistence();
    const options = createOptions({
      streamContent: 'first chunk',
      elapsedSeconds: 7,
      toolEvents: ['tool-live'],
      agentStatuses: ['agent-live'],
      pendingApproval: 'approval-1',
      persistence,
    });

    const { result } = renderManagedStreamingHook(options);

    await waitFor(() =>
      expect(result.current.streamingState.streamingMessageId).toBe('assistant-2')
    );
    await waitFor(() =>
      expect(persistence.persistLiveContent).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        ids: { statusMessageId: 'assistant-1', contentMessageId: 'assistant-2' },
        content: 'first chunk',
      })
    );

    expect(result.current.messages).toContainEqual(
      expect.objectContaining({
        id: 'assistant-2',
        content: 'first chunk',
        isStreaming: true,
      })
    );
    expect(result.current.messages).toContainEqual(
      expect.objectContaining({
        id: 'assistant-1',
        elapsedSeconds: 7,
        toolEvents: ['tool-live'],
        agentStatuses: ['agent-live'],
        pendingApproval: 'approval-1',
      })
    );
    expect(persistence.persistPlaceholderPair).toHaveBeenCalledWith('conversation-1', {
      statusMessageId: 'assistant-1',
      contentMessageId: 'assistant-2',
    });
    expect(persistence.persistLiveStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        elapsedSeconds: 7,
        toolEvents: ['tool-live'],
        agentStatuses: ['agent-live'],
        pendingApproval: 'approval-1',
      })
    );
    expect(persistence.persistToolEvents).toHaveBeenCalledWith(
      expect.objectContaining({ toolEvents: ['tool-live'] })
    );
    expect(persistence.persistAgentStatuses).toHaveBeenCalledWith(
      expect.objectContaining({ agentStatuses: ['agent-live'], pendingApproval: 'approval-1' })
    );
  });

  it('logs placeholder ids when debug mode is enabled', async () => {
    const logger = { debug: vi.fn(), error: vi.fn() };

    renderManagedStreamingHook(
      createOptions({
        debug: true,
        logger,
      })
    );

    await waitFor(() =>
      expect(logger.debug).toHaveBeenCalledWith(
        '[useManagedStreamingMessages] Creating placeholders',
        {
          statusMessageId: 'assistant-1',
          contentMessageId: 'assistant-2',
        }
      )
    );
  });

  it('shows buffered live content before placeholder persistence resolves', async () => {
    let resolvePlaceholderPersistence: (() => void) | null = null;
    const persistence = createPersistence({
      persistPlaceholderPair: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvePlaceholderPersistence = resolve;
          })
      ),
    });
    const options = createOptions({
      streamContent: 'first chunk',
      persistence,
    });

    const { result } = renderManagedStreamingHook(options);

    await waitFor(() =>
      expect(result.current.messages).toContainEqual(
        expect.objectContaining({
          id: 'assistant-2',
          content: 'first chunk',
          isStreaming: true,
        })
      )
    );
    expect(result.current.streamingState.streamingMessageId).toBeNull();
    expect(persistence.persistLiveContent).not.toHaveBeenCalled();

    await act(async () => {
      resolvePlaceholderPersistence?.();
    });

    await waitFor(() =>
      expect(result.current.streamingState.streamingMessageId).toBe('assistant-2')
    );
    await waitFor(() => expect(persistence.persistLiveContent).toHaveBeenCalledTimes(1));
  });

  it('rolls back pending placeholders when unmounted before persistence finishes', async () => {
    let resolvePlaceholderPersistence: (() => void) | null = null;
    const persistence = createPersistence({
      persistPlaceholderPair: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvePlaceholderPersistence = resolve;
          })
      ),
    });

    const { unmount } = renderManagedStreamingHook(createOptions({ persistence }));

    await waitFor(() => expect(persistence.persistPlaceholderPair).toHaveBeenCalledTimes(1));
    unmount();

    await act(async () => {
      resolvePlaceholderPersistence?.();
      await Promise.resolve();
    });

    expect(persistence.rollbackPlaceholderPair).toHaveBeenCalledWith(
      { statusMessageId: 'assistant-1', contentMessageId: 'assistant-2' },
      'conversation-1'
    );
  });

  it('persists live agent and tool status before response text starts streaming', async () => {
    const persistence = createPersistence();
    const options = createOptions({
      streamContent: '',
      elapsedSeconds: 5,
      toolEvents: ['tool-running'],
      agentStatuses: ['agent-working'],
      persistence,
    });

    const { result } = renderManagedStreamingHook(options);

    await waitFor(() =>
      expect(result.current.streamingState.streamingMessageId).toBe('assistant-2')
    );
    await waitFor(() =>
      expect(persistence.persistAgentStatuses).toHaveBeenCalledWith(
        expect.objectContaining({
          elapsedSeconds: 5,
          toolEvents: ['tool-running'],
          agentStatuses: ['agent-working'],
        })
      )
    );

    expect(result.current.messages).toContainEqual(
      expect.objectContaining({
        id: 'assistant-1',
        elapsedSeconds: 5,
        toolEvents: ['tool-running'],
        agentStatuses: ['agent-working'],
      })
    );
    expect(persistence.persistLiveContent).not.toHaveBeenCalled();
  });

  it('logs live tool and agent persistence failures without dropping local status updates', async () => {
    const toolError = new Error('tool write failed');
    const agentError = new Error('agent write failed');
    const persistence = createPersistence({
      persistToolEvents: vi.fn().mockRejectedValue(toolError),
      persistAgentStatuses: vi.fn().mockRejectedValue(agentError),
    });
    const logger = { debug: vi.fn(), error: vi.fn() };
    const options = createOptions({
      streamContent: '',
      elapsedSeconds: 6,
      toolEvents: ['tool-running'],
      finalToolEvents: ['tool-final'],
      agentStatuses: ['agent-running'],
      pendingApproval: 'approval-1',
      persistence,
      logger,
    });

    const { result } = renderManagedStreamingHook(options);

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        '[useManagedStreamingMessages] Failed to persist tool events',
        { error: toolError }
      )
    );
    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        '[useManagedStreamingMessages] Failed to persist agent statuses',
        { error: agentError }
      )
    );

    expect(result.current.messages).toContainEqual(
      expect.objectContaining({
        id: 'assistant-1',
        elapsedSeconds: 6,
        toolEvents: ['tool-final'],
        agentStatuses: ['agent-running'],
        pendingApproval: 'approval-1',
      })
    );
  });

  it('logs live content persistence failures after applying the local chunk', async () => {
    const contentError = new Error('content write failed');
    const persistence = createPersistence({
      persistLiveContent: vi.fn().mockRejectedValue(contentError),
    });
    const logger = { debug: vi.fn(), error: vi.fn() };
    const options = createOptions({
      streamContent: 'local first',
      persistence,
      logger,
    });

    const { result } = renderManagedStreamingHook(options);

    await waitFor(() =>
      expect(result.current.messages).toContainEqual(
        expect.objectContaining({
          id: 'assistant-2',
          content: 'local first',
        })
      )
    );
    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        '[useManagedStreamingMessages] Failed to update streaming content',
        { error: contentError }
      )
    );
  });

  it('waits for in-flight live persistence before writing the final state', async () => {
    const persistenceOrder: string[] = [];
    let resolveLivePersistence: (() => void) | undefined;
    const persistence = createPersistence({
      persistLiveContent: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            persistenceOrder.push('live-start');
            resolveLivePersistence = () => {
              persistenceOrder.push('live-finish');
              resolve();
            };
          })
      ),
      persistFinalState: vi.fn(async () => {
        persistenceOrder.push('final');
      }),
    });
    const initialOptions = createOptions({
      streamContent: 'partial response',
      persistence,
    });
    const { rerender } = renderManagedStreamingHook(initialOptions);

    await waitFor(() => expect(persistence.persistLiveContent).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        finalResponse: 'complete response',
      });
      await Promise.resolve();
    });

    expect(persistence.persistFinalState).not.toHaveBeenCalled();

    await act(async () => {
      resolveLivePersistence?.();
    });

    await waitFor(() => expect(persistence.persistFinalState).toHaveBeenCalledTimes(1));
    expect(persistenceOrder).toEqual(['live-start', 'live-finish', 'final']);
  });

  it('finalizes once with final payload fallbacks and invokes the completion callback', async () => {
    const persistence = createPersistence();
    const onFinalized = vi.fn().mockResolvedValue(undefined);
    const initialOptions = createOptions({
      sources: ['live-source'],
      finalSources: ['final-source'],
      toolEvents: ['live-tool'],
      finalToolEvents: ['final-tool'],
      agentStatuses: ['agent-final'],
      elapsedSeconds: 12,
      traceId: 'trace-1',
      persistence,
      onFinalized,
    });
    const { rerender } = renderManagedStreamingHook(initialOptions);

    await waitFor(() => expect(persistence.persistPlaceholderPair).toHaveBeenCalledTimes(1));

    const finalOptions = {
      ...initialOptions,
      isStreaming: false,
      finalResponse: 'Done',
    };
    await act(async () => {
      rerender(finalOptions);
    });
    await waitFor(() => expect(persistence.persistFinalState).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender(finalOptions);
    });

    expect(persistence.flushBeforeFinalState).toHaveBeenCalledTimes(1);
    expect(persistence.persistFinalState).toHaveBeenCalledWith(
      'conversation-1',
      { statusMessageId: 'assistant-1', contentMessageId: 'assistant-2' },
      {
        finalResponse: 'Done',
        sources: ['final-source'],
        toolEvents: ['final-tool'],
        elapsedSeconds: 12,
        agentStatuses: ['agent-final'],
        traceId: 'trace-1',
      }
    );
    expect(onFinalized).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      ids: { statusMessageId: 'assistant-1', contentMessageId: 'assistant-2' },
      finalResponse: 'Done',
    });
  });

  it('dispatches the final response after successful prop finalization when configured', async () => {
    const persistence = createPersistence();
    const initialOptions = createOptions({
      afterFinalState: 'dispatch-final',
      persistence,
    });
    const { result, rerender } = renderManagedStreamingHook(initialOptions);

    await waitFor(() =>
      expect(result.current.streamingState.streamingMessageId).toBe('assistant-2')
    );

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        finalResponse: 'Dispatched final',
      });
    });

    await waitFor(() => expect(persistence.persistFinalState).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current.messages).toContainEqual(
        expect.objectContaining({
          id: 'assistant-2',
          content: 'Dispatched final',
          isStreaming: false,
        })
      )
    );
  });

  it('finalizes from lifecycle state when configured', async () => {
    const persistence = createPersistence();
    const initialOptions = createOptions({
      finalizeFrom: 'state',
      persistence,
    });
    const { rerender } = renderManagedStreamingHook(initialOptions);

    await waitFor(() => expect(persistence.persistPlaceholderPair).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        finalResponse: 'State final',
      });
    });

    await waitFor(() => expect(persistence.persistFinalState).toHaveBeenCalledTimes(1));
    expect(persistence.persistFinalState).toHaveBeenCalledWith(
      'conversation-1',
      { statusMessageId: 'assistant-1', contentMessageId: 'assistant-2' },
      expect.objectContaining({ finalResponse: 'State final' })
    );
  });

  it('allows callers to resolve final sources from completion metadata', async () => {
    const persistence = createPersistence();
    const resolveFinalSources = vi.fn(
      ({
        sources: liveSources,
        finalSources: completedSources,
        toolEvents: liveToolEvents,
        finalToolEvents: completedToolEvents,
      }: {
        finalResponse: string;
        sources: string[];
        finalSources: string[];
        toolEvents: string[];
        finalToolEvents: string[];
      }) => [...completedSources, ...liveSources, ...completedToolEvents, ...liveToolEvents]
    );
    const initialOptions = createOptions({
      sources: ['live-source'],
      finalSources: [],
      toolEvents: ['live-tool'],
      finalToolEvents: ['final-tool'],
      persistence,
      resolveFinalSources,
    });
    const { rerender } = renderManagedStreamingHook(initialOptions);

    await waitFor(() => expect(persistence.persistPlaceholderPair).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        finalResponse: 'Done',
      });
    });

    await waitFor(() => expect(persistence.persistFinalState).toHaveBeenCalledTimes(1));
    expect(resolveFinalSources).toHaveBeenCalledWith({
      finalResponse: 'Done',
      sources: ['live-source'],
      finalSources: [],
      toolEvents: ['live-tool'],
      finalToolEvents: ['final-tool'],
    });
    expect(persistence.persistFinalState).toHaveBeenCalledWith(
      'conversation-1',
      { statusMessageId: 'assistant-1', contentMessageId: 'assistant-2' },
      expect.objectContaining({
        sources: ['live-source', 'final-tool', 'live-tool'],
        toolEvents: ['final-tool'],
      })
    );
  });

  it('snapshots completion metadata before awaiting final flush', async () => {
    let resolveFlush: (() => void) | undefined;
    const persistence = createPersistence({
      flushBeforeFinalState: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveFlush = resolve;
          })
      ),
    });
    const initialOptions = createOptions({
      sources: ['stream-a-source'],
      finalSources: [],
      toolEvents: ['stream-a-tool'],
      finalToolEvents: [],
      agentStatuses: ['stream-a-agent'],
      elapsedSeconds: 3,
      persistence,
    });
    const { rerender } = renderManagedStreamingHook(initialOptions);

    await waitFor(() => expect(persistence.persistPlaceholderPair).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        finalResponse: 'Done',
      });
    });
    await waitFor(() => expect(persistence.flushBeforeFinalState).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        finalResponse: 'Done',
        sources: ['stream-b-source'],
        finalSources: ['stream-b-final-source'],
        toolEvents: ['stream-b-tool'],
        finalToolEvents: ['stream-b-final-tool'],
        agentStatuses: ['stream-b-agent'],
        elapsedSeconds: 99,
      });
      resolveFlush?.();
    });

    await waitFor(() => expect(persistence.persistFinalState).toHaveBeenCalledTimes(1));
    expect(persistence.persistFinalState).toHaveBeenCalledWith(
      'conversation-1',
      { statusMessageId: 'assistant-1', contentMessageId: 'assistant-2' },
      expect.objectContaining({
        finalResponse: 'Done',
        sources: ['stream-a-source'],
        toolEvents: ['stream-a-tool'],
        agentStatuses: ['stream-a-agent'],
        elapsedSeconds: 3,
      })
    );
  });

  it('cancels stale finalization when the final response is cleared during a flush', async () => {
    let resolveFlush: (() => void) | undefined;
    const persistence = createPersistence({
      flushBeforeFinalState: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveFlush = resolve;
          })
      ),
    });
    const initialOptions = createOptions({ persistence });
    const { rerender } = renderManagedStreamingHook(initialOptions);

    await waitFor(() => expect(persistence.persistPlaceholderPair).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        finalResponse: 'stale final response',
      });
    });
    await waitFor(() => expect(persistence.flushBeforeFinalState).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        finalResponse: null,
      });
    });
    await act(async () => {
      resolveFlush?.();
      await Promise.resolve();
    });

    expect(persistence.persistFinalState).not.toHaveBeenCalled();
  });

  it('cancels finalization when unmounted during a flush', async () => {
    let resolveFlush: (() => void) | undefined;
    const persistence = createPersistence({
      flushBeforeFinalState: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveFlush = resolve;
          })
      ),
    });
    const initialOptions = createOptions({ persistence });
    const { rerender, unmount } = renderManagedStreamingHook(initialOptions);

    await waitFor(() => expect(persistence.persistPlaceholderPair).toHaveBeenCalledTimes(1));
    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        finalResponse: 'pending final response',
      });
    });
    await waitFor(() => expect(persistence.flushBeforeFinalState).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      resolveFlush?.();
      await Promise.resolve();
    });

    expect(persistence.persistFinalState).not.toHaveBeenCalled();
  });

  it('cancels stale error persistence when the error is cleared during a flush', async () => {
    let resolveFlush: (() => void) | undefined;
    const persistence = createPersistence({
      flushBeforeErrorState: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveFlush = resolve;
          })
      ),
    });
    const initialOptions = createOptions({ persistence });
    const { rerender } = renderManagedStreamingHook(initialOptions);

    await waitFor(() => expect(persistence.persistPlaceholderPair).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        errorMessage: 'stale error',
      });
    });
    await waitFor(() => expect(persistence.flushBeforeErrorState).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        errorMessage: null,
      });
    });
    await act(async () => {
      resolveFlush?.();
      await Promise.resolve();
    });

    expect(persistence.persistErrorState).not.toHaveBeenCalled();
  });

  it('cancels error persistence when unmounted during a flush', async () => {
    let resolveFlush: (() => void) | undefined;
    const persistence = createPersistence({
      flushBeforeErrorState: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveFlush = resolve;
          })
      ),
    });
    const initialOptions = createOptions({ persistence });
    const { rerender, unmount } = renderManagedStreamingHook(initialOptions);

    await waitFor(() => expect(persistence.persistPlaceholderPair).toHaveBeenCalledTimes(1));
    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        errorMessage: 'pending error',
      });
    });
    await waitFor(() => expect(persistence.flushBeforeErrorState).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      resolveFlush?.();
      await Promise.resolve();
    });

    expect(persistence.persistErrorState).not.toHaveBeenCalled();
  });

  it('logs finalization persistence failures and resets when configured', async () => {
    const finalError = new Error('final write failed');
    const persistence = createPersistence({
      persistFinalState: vi.fn().mockRejectedValue(finalError),
    });
    const logger = { debug: vi.fn(), error: vi.fn() };
    const initialOptions = createOptions({
      afterFinalState: 'reset',
      persistence,
      logger,
    });
    const { result, rerender } = renderManagedStreamingHook(initialOptions);

    await waitFor(() =>
      expect(result.current.streamingState.streamingMessageId).toBe('assistant-2')
    );

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        finalResponse: 'Done',
      });
    });

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        '[useManagedStreamingMessages] Finalization failed',
        { error: finalError }
      )
    );
    await waitFor(() => expect(result.current.streamingState.streamingMessageId).toBeNull());
  });

  it('persists errors, clears sources locally, and resets when configured for state finalization', async () => {
    const persistence = createPersistence();
    const onErrorPersisted = vi.fn().mockResolvedValue(undefined);
    const initialOptions = createOptions({
      finalizeFrom: 'state',
      resetWhenIdle: true,
      afterErrorState: 'reset',
      clearSourcesOnError: true,
      persistence,
      onErrorPersisted,
    });
    const { result, rerender } = renderManagedStreamingHook(initialOptions);

    await waitFor(() =>
      expect(result.current.streamingState.streamingMessageId).toBe('assistant-2')
    );

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        errorMessage: 'Network failure',
      });
    });

    await waitFor(() => expect(persistence.persistErrorState).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.streamingState.streamingMessageId).toBeNull());

    expect(persistence.flushBeforeErrorState).toHaveBeenCalledTimes(1);
    expect(persistence.persistErrorState).toHaveBeenCalledWith(
      'conversation-1',
      'assistant-2',
      'Network failure'
    );
    expect(result.current.messages).toContainEqual(
      expect.objectContaining({
        id: 'assistant-2',
        content: 'Network failure',
        isStreaming: false,
        error: 'Network failure',
        sources: [],
      })
    );
    expect(onErrorPersisted).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      contentMessageId: 'assistant-2',
      message: 'Network failure',
    });
  });

  it('logs error persistence failures and dispatches the error state when configured', async () => {
    const errorWriteFailure = new Error('error write failed');
    const persistence = createPersistence({
      persistErrorState: vi.fn().mockRejectedValue(errorWriteFailure),
    });
    const logger = { debug: vi.fn(), error: vi.fn() };
    const initialOptions = createOptions({
      finalizeFrom: 'state',
      afterErrorState: 'dispatch-error',
      persistence,
      logger,
    });
    const { result, rerender } = renderManagedStreamingHook(initialOptions);

    await waitFor(() =>
      expect(result.current.streamingState.streamingMessageId).toBe('assistant-2')
    );

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        errorMessage: 'Network failure',
      });
    });

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        '[useManagedStreamingMessages] Failed to handle error state',
        { error: errorWriteFailure }
      )
    );
    expect(persistence.persistErrorState).toHaveBeenCalledWith(
      'conversation-1',
      'assistant-2',
      'Network failure'
    );
    expect(result.current.streamingState.streamingMessageId).toBeNull();
  });

  it('dispatches the error state after successful error persistence when configured', async () => {
    const persistence = createPersistence();
    const initialOptions = createOptions({
      finalizeFrom: 'state',
      afterErrorState: 'dispatch-error',
      persistence,
    });
    const { result, rerender } = renderManagedStreamingHook(initialOptions);

    await waitFor(() =>
      expect(result.current.streamingState.streamingMessageId).toBe('assistant-2')
    );

    await act(async () => {
      rerender({
        ...initialOptions,
        isStreaming: false,
        errorMessage: 'Persisted failure',
      });
    });

    await waitFor(() => expect(persistence.persistErrorState).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current.messages).toContainEqual(
        expect.objectContaining({
          id: 'assistant-2',
          content: 'Persisted failure',
          isStreaming: false,
          error: 'Persisted failure',
        })
      )
    );
  });

  it('rolls back local placeholders and reports placeholder creation failures', async () => {
    const persistence = createPersistence({
      persistPlaceholderPair: vi.fn().mockRejectedValue(new Error('write failed')),
    });
    const logger = { debug: vi.fn(), error: vi.fn() };
    const { result } = renderManagedStreamingHook(createOptions({ persistence, logger }));

    await waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));

    expect(persistence.rollbackPlaceholderPair).toHaveBeenCalledWith(
      { statusMessageId: 'assistant-1', contentMessageId: 'assistant-2' },
      'conversation-1'
    );
    expect(result.current.streamingState.streamingMessageId).toBeNull();
  });
});
