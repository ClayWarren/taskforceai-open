import { describe, expect, it } from 'bun:test';

import { createStreamingPersistence, type StreamingMessageUpsert } from './streamingPersistence';

describe('streaming persistence', () => {
  const pairIds = {
    statusMessageId: 'status-1',
    contentMessageId: 'content-1',
  };

  it('persists and rolls back placeholder message pairs', async () => {
    const upserts: StreamingMessageUpsert<string, string, { status: string }>[] = [];
    const deleted: Array<{ messageId: string; conversationId: string }> = [];
    let messages = [{ id: 'status-1' }, { id: 'content-1' }, { id: 'existing-message' }];
    const setMessages = (
      updater: { (previous: Array<{ id: string }>): Array<{ id: string }> } | Array<{ id: string }>
    ) => {
      messages = typeof updater === 'function' ? updater(messages) : updater;
    };
    const persistence = createStreamingPersistence<
      string,
      string,
      { status: string },
      unknown,
      {
        id: string;
      }
    >({
      upsertMessage: async (payload) => {
        upserts.push(payload);
      },
      deleteMessage: async (messageId, conversationId) => {
        deleted.push({ messageId, conversationId });
      },
      setMessages,
      placeholderMeta: (kind) => ({
        content: kind === 'status' ? 'Working' : '',
        trace_id: `${kind}-trace`,
      }),
    });

    await persistence.persistPlaceholderPair('conversation-1', pairIds);
    persistence.rollbackPlaceholderPair?.(pairIds, 'conversation-1');

    expect(upserts).toEqual([
      expect.objectContaining({
        messageId: 'status-1',
        isStreaming: true,
        isAgentStatus: true,
        content: 'Working',
        trace_id: 'status-trace',
        toolEvents: [],
      }),
      expect.objectContaining({
        messageId: 'content-1',
        isStreaming: true,
        isAgentStatus: false,
        trace_id: 'content-trace',
        toolEvents: [],
      }),
    ]);
    expect(messages).toEqual([{ id: 'existing-message' }]);
    expect(deleted).toEqual([
      { messageId: 'status-1', conversationId: 'conversation-1' },
      { messageId: 'content-1', conversationId: 'conversation-1' },
    ]);
  });

  it('queues live content and tool events when batching hooks are provided', async () => {
    const liveContent: unknown[] = [];
    const queuedToolEvents: unknown[] = [];
    const persistence = createStreamingPersistence<string, string, { status: string }>({
      upsertMessage: async () => {
        throw new Error('upsert should not run for queued live updates');
      },
      queueLiveContent: (payload) => {
        liveContent.push(payload);
      },
      queueToolEvents: (payload) => {
        queuedToolEvents.push(payload);
      },
    });

    persistence.persistLiveContent({
      conversationId: 'conversation-1',
      ids: pairIds,
      content: 'partial answer',
    });
    persistence.persistToolEvents?.({
      conversationId: 'conversation-1',
      ids: pairIds,
      toolEvents: ['tool-1'],
    });

    expect(liveContent).toEqual([
      {
        conversationId: 'conversation-1',
        messageId: 'content-1',
        content: 'partial answer',
        isStreaming: true,
        error: null,
        sources: [],
        isAgentStatus: false,
      },
    ]);
    expect(queuedToolEvents).toEqual([
      {
        conversationId: 'conversation-1',
        messageId: 'status-1',
        toolEvents: ['tool-1'],
      },
    ]);
  });

  it('persists live content, agent statuses, and clear-source error snapshots', async () => {
    const upserts: StreamingMessageUpsert<string, string, { status: string }, { id: string }>[] =
      [];
    const persistence = createStreamingPersistence<
      string,
      string,
      { status: string },
      { id: string }
    >({
      upsertMessage: async (payload) => {
        upserts.push(payload);
      },
      clearErrorSources: true,
    });

    await persistence.persistLiveContent({
      conversationId: 'conversation-1',
      ids: pairIds,
      content: 'partial answer',
    });
    await persistence.persistAgentStatuses!({
      conversationId: 'conversation-1',
      ids: pairIds,
      elapsedSeconds: 5,
      toolEvents: ['tool-1'],
      agentStatuses: [{ status: 'RUNNING' }],
      pendingApproval: { id: 'approval-1' },
    });
    await persistence.persistErrorState('conversation-1', 'content-1', 'failed');

    expect(upserts).toContainEqual(
      expect.objectContaining({
        conversationId: 'conversation-1',
        messageId: 'content-1',
        content: 'partial answer',
        isStreaming: true,
        isAgentStatus: false,
      })
    );
    expect(upserts).toContainEqual(
      expect.objectContaining({
        conversationId: 'conversation-1',
        messageId: 'status-1',
        isStreaming: true,
        isAgentStatus: true,
        elapsedSeconds: 5,
        sources: [],
        toolEvents: ['tool-1'],
        agentStatuses: [{ status: 'RUNNING' }],
        pendingApproval: { id: 'approval-1' },
      })
    );
    expect(upserts).toContainEqual(
      expect.objectContaining({
        conversationId: 'conversation-1',
        messageId: 'content-1',
        content: 'failed',
        isStreaming: false,
        error: 'failed',
        sources: [],
      })
    );
  });

  it('persists the completed status and answer snapshots with run metadata', async () => {
    const upserts: StreamingMessageUpsert<string, string, { status: string; model?: string }>[] =
      [];
    const persistence = createStreamingPersistence<
      string,
      string,
      { status: string; model?: string }
    >({
      upsertMessage: async (payload) => {
        upserts.push(payload);
      },
    });

    await persistence.persistFinalState('conversation-1', pairIds, {
      finalResponse: 'done',
      sources: ['source-1'],
      toolEvents: ['tool-1'],
      elapsedSeconds: 42,
      agentStatuses: [{ status: 'COMPLETED', model: 'sentinel' }],
      traceId: 'trace-1',
    });

    expect(upserts).toContainEqual(
      expect.objectContaining({
        conversationId: 'conversation-1',
        messageId: 'status-1',
        isStreaming: false,
        isAgentStatus: true,
        elapsedSeconds: 42,
        sources: ['source-1'],
        toolEvents: ['tool-1'],
        agentStatuses: [{ status: 'COMPLETED', model: 'sentinel' }],
        trace_id: 'trace-1',
      })
    );
    expect(upserts).toContainEqual(
      expect.objectContaining({
        conversationId: 'conversation-1',
        messageId: 'content-1',
        content: 'done',
        isStreaming: false,
        isAgentStatus: false,
        elapsedSeconds: 42,
        sources: ['source-1'],
        trace_id: 'trace-1',
      })
    );
    expect(upserts.find((upsert) => upsert.messageId === 'content-1')).toMatchObject({
      toolEvents: [],
    });
    expect(upserts.find((upsert) => upsert.messageId === 'content-1')).not.toMatchObject({
      agentStatuses: expect.any(Array),
    });
  });

  it('persists pending approval on live status snapshots', async () => {
    const upserts: StreamingMessageUpsert<string, string, { status: string }, { id: string }>[] =
      [];
    const persistence = createStreamingPersistence<
      string,
      string,
      { status: string },
      { id: string }
    >({
      upsertMessage: async (payload) => {
        upserts.push(payload);
      },
    });

    await persistence.persistLiveStatus?.({
      conversationId: 'conversation-1',
      ids: pairIds,
      elapsedSeconds: 3,
      toolEvents: [],
      agentStatuses: [{ status: 'WAITING' }],
      pendingApproval: { id: 'approval-1' },
    });

    expect(upserts).toContainEqual(
      expect.objectContaining({
        conversationId: 'conversation-1',
        messageId: 'status-1',
        isStreaming: true,
        isAgentStatus: true,
        pendingApproval: { id: 'approval-1' },
      })
    );
  });

  it('persists generated file tool events on the completed answer snapshot', async () => {
    type ToolEvent = {
      toolName: string;
      generatedFile?: { filename: string; downloadUrl?: string };
    };
    const upserts: StreamingMessageUpsert<string, ToolEvent, { status: string }>[] = [];
    const persistence = createStreamingPersistence<string, ToolEvent, { status: string }>({
      upsertMessage: async (payload) => {
        upserts.push(payload);
      },
    });
    const generatedFileEvent = {
      toolName: 'create_spreadsheet',
      generatedFile: {
        filename: 'sunlight-planets.xlsx',
        downloadUrl: '/api/v1/developer/files/file-1/content',
      },
    };

    await persistence.persistFinalState('conversation-1', pairIds, {
      finalResponse: 'done',
      sources: [],
      toolEvents: [{ toolName: 'execute_code' }, generatedFileEvent],
      elapsedSeconds: 42,
      agentStatuses: [{ status: 'COMPLETED' }],
    });

    expect(upserts.find((upsert) => upsert.messageId === 'content-1')?.toolEvents).toEqual([
      generatedFileEvent,
    ]);
    expect(upserts.find((upsert) => upsert.messageId === 'status-1')?.toolEvents).toEqual([
      { toolName: 'execute_code' },
      generatedFileEvent,
    ]);
  });
});
