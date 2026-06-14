import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

import {
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

vi.mock('@taskforceai/shared/utils/id', () => ({
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
