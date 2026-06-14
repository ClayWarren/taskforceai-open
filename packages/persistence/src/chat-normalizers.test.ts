import { describe, expect, it } from 'bun:test';

import {
  createPreview,
  mapToStorageConversation,
  mapToStorageMessage,
  normalizeAgentStatuses,
  normalizeSourceReferences,
  normalizeToolEvents,
} from './chat-normalizers';

describe('persistence/chat-normalizers', () => {
  it('createPreview trims and truncates long content', () => {
    expect(createPreview('  short text  ')).toBe('short text');

    const long = ` ${'a'.repeat(260)} `;
    const preview = createPreview(long);
    expect(preview.length).toBe(241);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('normalizeSourceReferences filters invalid entries', () => {
    const normalized = normalizeSourceReferences([
      { url: 'https://example.com/1', title: 'One', snippet: 'Snippet' },
      { url: 'https://example.com/2' },
      { url: 42 },
      { title: 'Missing URL' },
      null,
    ]);

    expect(normalized).toEqual([
      { url: 'https://example.com/1', title: 'One', snippet: 'Snippet' },
      { url: 'https://example.com/2' },
    ]);
    expect(normalizeSourceReferences('not-an-array')).toEqual([]);
  });

  it('normalizeToolEvents validates shape and defaults arguments', () => {
    const normalized = normalizeToolEvents([
      {
        agentId: 7,
        agentLabel: 'Agent A',
        toolName: 'search',
        success: true,
        durationMs: 123,
        timestamp: '2026-01-01T00:00:00Z',
        resultPreview: 'done',
        image_base64: 'abc123',
        sources: [{ url: 'https://source.example', title: 'Source' }, { bad: true }],
      },
      {
        agentLabel: 'Agent B',
        toolName: 'code',
        success: false,
        durationMs: 50,
        arguments: { query: 'x' },
        error: 'boom',
      },
      { agentLabel: 'Bad', toolName: 'bad', success: 'true', durationMs: 1 },
    ]);

    expect(normalized).toEqual([
      {
        agentId: 7,
        agentLabel: 'Agent A',
        toolName: 'search',
        success: true,
        durationMs: 123,
        arguments: {},
        timestamp: '2026-01-01T00:00:00Z',
        resultPreview: 'done',
        image_base64: 'abc123',
        sources: [{ url: 'https://source.example', title: 'Source' }],
      },
      {
        agentLabel: 'Agent B',
        toolName: 'code',
        success: false,
        durationMs: 50,
        arguments: { query: 'x' },
        error: 'boom',
      },
    ]);
    expect(normalizeToolEvents(null)).toEqual([]);
  });

  it('normalizeAgentStatuses keeps only valid snapshots', () => {
    const normalized = normalizeAgentStatuses([
      {
        status: 'running',
        agent_id: 3,
        progress: 0.4,
        result: 'ok',
        reasoning: 'Checking files',
        model: 'xai/grok-4.3',
      },
      { status: 'queued' },
      { status: 5 },
      { progress: 0.5 },
    ]);

    expect(normalized).toEqual([
      {
        status: 'running',
        agent_id: 3,
        progress: 0.4,
        result: 'ok',
        reasoning: 'Checking files',
        model: 'xai/grok-4.3',
      },
      { status: 'queued' },
    ]);
    expect(normalizeAgentStatuses(undefined)).toEqual([]);
  });

  it('mapToStorageConversation applies defaults and optional fields', () => {
    expect(
      mapToStorageConversation({
        conversationId: 'conv-1',
        title: 'Conversation',
        createdAt: 1,
        updatedAt: 2,
      })
    ).toEqual({
      conversationId: 'conv-1',
      title: 'Conversation',
      createdAt: 1,
      updatedAt: 2,
      lastMessagePreview: null,
      syncVersion: 0,
      lastSyncedAt: 0,
      isDeleted: false,
    });

    expect(
      mapToStorageConversation({
        id: 9,
        conversationId: 'conv-2',
        title: 'Conversation 2',
        createdAt: 3,
        updatedAt: 4,
        lastMessagePreview: 'preview',
        syncVersion: 8,
        lastSyncedAt: 10,
        deviceId: 'device-x',
        isDeleted: true,
      })
    ).toEqual({
      id: 9,
      conversationId: 'conv-2',
      title: 'Conversation 2',
      createdAt: 3,
      updatedAt: 4,
      lastMessagePreview: 'preview',
      syncVersion: 8,
      lastSyncedAt: 10,
      deviceId: 'device-x',
      isDeleted: true,
    });

    expect(
      mapToStorageConversation({
        conversationId: 'conv-archived',
        title: 'Archived',
        createdAt: 5,
        updatedAt: 6,
        isArchived: true,
      })
    ).toEqual({
      conversationId: 'conv-archived',
      title: 'Archived',
      createdAt: 5,
      updatedAt: 6,
      lastMessagePreview: null,
      syncVersion: 0,
      lastSyncedAt: 0,
      isDeleted: false,
      isArchived: true,
    });

    expect(
      mapToStorageConversation({
        conversationId: 'conv-legacy-archived',
        title: 'Legacy Archived',
        createdAt: 7,
        updatedAt: 8,
        is_archived: true,
      }).isArchived
    ).toBe(true);
  });

  it('mapToStorageMessage normalizes nested arrays and nullable optionals', () => {
    const mapped = mapToStorageMessage({
      id: 5,
      messageId: 'msg-1',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'hello',
      isStreaming: false,
      isAgentStatus: true,
      elapsedSeconds: 15,
      createdAt: 11,
      updatedAt: 12,
      error: 'oops',
      sources: [{ url: 'https://source.example', title: 'Source' }, { bad: true }],
      toolEvents: [
        {
          agentLabel: 'Runner',
          toolName: 'search',
          success: true,
          durationMs: 10,
          sources: [{ url: 'https://tool.example', title: 'Tool source' }, { bad: true }],
        },
        { agentLabel: 'Bad', success: true },
      ],
      agentStatuses: [{ status: 'running', progress: 0.5 }, { progress: 0.3 }],
      traceId: 'trace-123',
      syncVersion: 4,
      lastSyncedAt: 20,
      deviceId: 'device-a',
      isDeleted: true,
    });

    expect(mapped).toEqual({
      id: 5,
      messageId: 'msg-1',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'hello',
      isStreaming: false,
      isAgentStatus: true,
      elapsedSeconds: 15,
      createdAt: 11,
      updatedAt: 12,
      error: 'oops',
      sources: [{ url: 'https://source.example', title: 'Source' }],
      toolEvents: [
        {
          agentLabel: 'Runner',
          toolName: 'search',
          success: true,
          durationMs: 10,
          arguments: {},
          sources: [{ url: 'https://tool.example', title: 'Tool source' }],
        },
      ],
      agentStatuses: [{ status: 'running', progress: 0.5 }],
      traceId: 'trace-123',
      syncVersion: 4,
      lastSyncedAt: 20,
      deviceId: 'device-a',
      isDeleted: true,
    });

    const defaults = mapToStorageMessage({
      messageId: 'msg-2',
      conversationId: 'conv-2',
      role: 'user',
      content: 'raw',
      isStreaming: true,
      createdAt: 100,
      updatedAt: 101,
      sources: 'bad-source',
      toolEvents: 'bad-events',
      agentStatuses: 'bad-statuses',
    });

    expect(defaults.syncVersion).toBe(0);
    expect(defaults.lastSyncedAt).toBe(0);
    expect(defaults.isDeleted).toBe(false);
    expect(defaults.sources).toEqual([]);
    expect(defaults.toolEvents).toEqual([]);
    expect(defaults.agentStatuses).toEqual([]);
    expect('id' in defaults).toBe(false);
    expect('error' in defaults).toBe(false);
    expect('traceId' in defaults).toBe(false);

    expect(
      mapToStorageMessage({
        messageId: 'msg-3',
        conversationId: 'conv-3',
        role: 'assistant',
        content: 'with legacy trace',
        isStreaming: false,
        createdAt: 102,
        updatedAt: 103,
        trace_id: 'legacy-trace-1',
      }).traceId
    ).toBe('legacy-trace-1');
  });

  it('normalizeSourceReferences handles invalid title and snippet types', () => {
    const normalized = normalizeSourceReferences([
      { url: 'https://example.com/1', title: 42, snippet: true },
    ]);
    expect(normalized).toEqual([]);
  });

  it('normalizeToolEvents handles invalid optional field types', () => {
    const baseEvent = {
      agentLabel: 'Agent',
      toolName: 'tool',
      success: true,
      durationMs: 100,
    };

    expect(
      normalizeToolEvents([
        {
          ...baseEvent,
          agentId: 'not-a-number',
        },
      ])
    ).toEqual([]);
    expect(
      normalizeToolEvents([
        {
          ...baseEvent,
          resultPreview: 42,
        },
      ])
    ).toEqual([]);
    expect(
      normalizeToolEvents([
        {
          ...baseEvent,
          error: {},
        },
      ])
    ).toEqual([]);
    expect(
      normalizeToolEvents([
        {
          ...baseEvent,
          image_base64: 123,
        },
      ])
    ).toEqual([]);
  });

  it('normalizeToolEvents rejects invalid required field types', () => {
    expect(normalizeToolEvents([null])).toEqual([]);
    expect(
      normalizeToolEvents([
        {
          toolName: 'tool',
          success: true,
          durationMs: 100,
        },
      ])
    ).toEqual([]);
    expect(
      normalizeToolEvents([
        {
          agentLabel: 'Agent',
          success: true,
          durationMs: 100,
        },
      ])
    ).toEqual([]);
    expect(
      normalizeToolEvents([
        {
          agentLabel: 'Agent',
          toolName: 'tool',
          durationMs: 100,
        },
      ])
    ).toEqual([]);
    expect(
      normalizeToolEvents([
        {
          agentLabel: 'Agent',
          toolName: 'tool',
          success: true,
          durationMs: 'slow',
        },
      ])
    ).toEqual([]);
  });

  it('normalizeSourceReferences rejects non-record and invalid optional fields independently', () => {
    expect(normalizeSourceReferences([null, 'source'])).toEqual([]);
    expect(normalizeSourceReferences([{ url: 'https://example.com', title: 42 }])).toEqual([]);
    expect(normalizeSourceReferences([{ url: 'https://example.com', snippet: true }])).toEqual([]);
  });

  it('normalizeAgentStatuses rejects each invalid optional field independently', () => {
    expect(normalizeAgentStatuses([null])).toEqual([]);
    expect(normalizeAgentStatuses([{ status: 'running', agent_id: '1' }])).toEqual([]);
    expect(normalizeAgentStatuses([{ status: 'running', progress: '0.5' }])).toEqual([]);
    expect(normalizeAgentStatuses([{ status: 'running', result: 42 }])).toEqual([]);
    expect(normalizeAgentStatuses([{ status: 'running', reasoning: 42 }])).toEqual([]);
    expect(normalizeAgentStatuses([{ status: 'running', model: 13 }])).toEqual([]);
  });

  it('mapToStorageMessage omits nullable optional fields while preserving falsey values', () => {
    const mapped = mapToStorageMessage({
      id: null,
      messageId: 'msg-nullable',
      conversationId: 'conv-nullable',
      role: 'assistant',
      content: 'nullable',
      isStreaming: false,
      isAgentStatus: false,
      elapsedSeconds: 0,
      createdAt: 1,
      updatedAt: 2,
      error: null,
      traceId: null,
      deviceId: null,
      syncVersion: null,
      lastSyncedAt: null,
      isDeleted: null,
    });

    expect(mapped).toEqual({
      messageId: 'msg-nullable',
      conversationId: 'conv-nullable',
      role: 'assistant',
      content: 'nullable',
      isStreaming: false,
      isAgentStatus: false,
      elapsedSeconds: 0,
      createdAt: 1,
      updatedAt: 2,
      sources: [],
      toolEvents: [],
      agentStatuses: [],
      syncVersion: 0,
      lastSyncedAt: 0,
      isDeleted: false,
    });
  });

  it('mapToStorageConversation omits null id and deviceId while preserving falsey metadata', () => {
    expect(
      mapToStorageConversation({
        id: null,
        conversationId: 'conv-nullable',
        title: 'Nullable',
        createdAt: 0,
        updatedAt: 0,
        lastMessagePreview: '',
        syncVersion: 0,
        lastSyncedAt: 0,
        deviceId: null,
        isDeleted: false,
      })
    ).toEqual({
      conversationId: 'conv-nullable',
      title: 'Nullable',
      createdAt: 0,
      updatedAt: 0,
      lastMessagePreview: '',
      syncVersion: 0,
      lastSyncedAt: 0,
      isDeleted: false,
    });
  });

  it('normalizeToolEvents handles invalid optional field types in a combined payload', () => {
    const normalized = normalizeToolEvents([
      {
        agentLabel: 'Agent',
        toolName: 'tool',
        success: true,
        durationMs: 100,
        agentId: 'not-a-number',
        resultPreview: 42,
        error: {},
        image_base64: 123,
      },
    ]);
    expect(normalized).toEqual([]);
  });

  it('normalizeToolEvents rejects non-string timestamp values', () => {
    const normalized = normalizeToolEvents([
      {
        agentLabel: 'Agent',
        toolName: 'tool',
        success: true,
        durationMs: 100,
        timestamp: 123,
      },
    ]);

    expect(normalized).toEqual([]);
  });

  it('normalizeAgentStatuses handles invalid field types', () => {
    const normalized = normalizeAgentStatuses([
      { status: 'running', agent_id: 'not-a-number', progress: 'not-a-number', result: 42 },
    ]);
    expect(normalized).toEqual([]);
  });

  it('normalizeAgentStatuses validates result type when present', () => {
    const normalized = normalizeAgentStatuses([{ status: 'running', result: 42 }]);
    expect(normalized).toEqual([]);
  });

  it('normalizeAgentStatuses validates reasoning/model types when present', () => {
    const normalized = normalizeAgentStatuses([
      { status: 'running', reasoning: 42 },
      { status: 'running', model: 13 },
    ]);
    expect(normalized).toEqual([]);
  });

  it('createPreview handles empty string', () => {
    expect(createPreview('')).toBe('');
    expect(createPreview('   ')).toBe('');
  });
});
