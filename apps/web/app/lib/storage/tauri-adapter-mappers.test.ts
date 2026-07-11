import { describe, expect, it, vi } from 'bun:test';
import type { PendingChange, StorageConversation, StorageMessage } from '@taskforceai/persistence';

const loggerWarnMock = vi.fn();

vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
  },
}));

import {
  isRecord,
  toCompatRawMessage,
  toPendingChange,
  toRawConversation,
  toRawMessage,
  toRawPendingChange,
} from './tauri-adapter-mappers';

describe('tauri adapter mappers', () => {
  const sampleToolEvent = {
    agentLabel: 'Assistant',
    toolName: 'search',
    arguments: { query: 'docs' },
    success: true,
    durationMs: 42,
  };

  const conversation = {
    id: 7,
    conversationId: 'conv-1',
    title: 'Planning',
    createdAt: 1710000000000,
    updatedAt: 1710000001000,
    lastMessagePreview: null,
    syncVersion: 2,
    lastSyncedAt: 1710000002000,
    deviceId: 'device-1',
    isDeleted: false,
    isArchived: true,
  } satisfies StorageConversation;

  const message = {
    id: 9,
    messageId: 'msg-1',
    conversationId: 'conv-1',
    role: 'assistant',
    content: 'Done',
    isStreaming: false,
    isAgentStatus: true,
    isLocalCommandOutput: true,
    elapsedSeconds: 3,
    error: null,
    sources: [{ title: 'Docs', url: 'https://example.com/docs' }],
    toolEvents: [sampleToolEvent],
    agentStatuses: [{ status: 'complete', agent_id: 1 }],
    createdAt: 1710000000000,
    updatedAt: 1710000001000,
    syncVersion: 2,
    lastSyncedAt: 1710000002000,
    deviceId: 'device-1',
    traceId: 'trace-1',
    isDeleted: false,
  } satisfies StorageMessage;

  it('maps conversations and messages into raw desktop records with optional fields', () => {
    expect(isRecord({ id: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);

    expect(toRawConversation(conversation)).toEqual({
      id: 7,
      conversationId: 'conv-1',
      title: 'Planning',
      createdAt: 1710000000000,
      updatedAt: 1710000001000,
      lastMessagePreview: null,
      syncVersion: 2,
      lastSyncedAt: 1710000002000,
      deviceId: 'device-1',
      isDeleted: false,
      isArchived: true,
    });

    expect(toRawMessage(message)).toEqual({
      id: 9,
      messageId: 'msg-1',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Done',
      isStreaming: false,
      isAgentStatus: true,
      isLocalCommandOutput: true,
      elapsedSeconds: 3,
      error: null,
      sources: [{ title: 'Docs', url: 'https://example.com/docs' }],
      toolEvents: [sampleToolEvent],
      agentStatuses: [{ status: 'complete', agent_id: 1 }],
      createdAt: 1710000000000,
      updatedAt: 1710000001000,
      syncVersion: 2,
      lastSyncedAt: 1710000002000,
      deviceId: 'device-1',
      traceId: 'trace-1',
      isDeleted: false,
    });
  });

  it('round-trips pending changes through raw desktop records', () => {
    const change = {
      id: 12,
      type: 'message',
      entityId: 'msg-1',
      operation: 'update',
      data: { content: 'Updated' },
      createdAt: 1710000003000,
    } satisfies PendingChange;

    const raw = toRawPendingChange(change);

    expect(raw).toEqual({
      id: 12,
      type: 'message',
      entityId: 'msg-1',
      operation: 'update',
      data: { content: 'Updated' },
      createdAt: 1710000003000,
    });
    expect(toPendingChange(raw)).toEqual(change);
    expect(toPendingChange({ ...raw, id: null })).toEqual({
      type: 'message',
      entityId: 'msg-1',
      operation: 'update',
      data: { content: 'Updated' },
      createdAt: 1710000003000,
    });
  });

  it('parses legacy JSON array fields from desktop messages', () => {
    const raw = toCompatRawMessage({
      ...toRawMessage(message),
      sources: JSON.stringify([{ title: 'Parsed', url: 'https://example.com/parsed' }]),
      toolEvents: JSON.stringify([
        {
          agentLabel: 'Assistant',
          toolName: 'parsed-tool',
          arguments: {},
          success: true,
          durationMs: 12,
        },
      ]),
      agentStatuses: JSON.stringify([{ status: 'running', agent_id: 2 }]),
    });

    expect(raw.sources).toEqual([{ title: 'Parsed', url: 'https://example.com/parsed' }]);
    expect(raw.toolEvents).toEqual([
      {
        agentLabel: 'Assistant',
        toolName: 'parsed-tool',
        arguments: {},
        success: true,
        durationMs: 12,
      },
    ]);
    expect(raw.agentStatuses).toEqual([{ status: 'running', agent_id: 2 }]);
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('leaves malformed legacy array fields unchanged and warns once per value', () => {
    const malformed = '{bad json';
    const first = toCompatRawMessage({
      ...toRawMessage(message),
      sources: malformed,
      toolEvents: [],
      agentStatuses: [],
    });
    const second = toCompatRawMessage({
      ...toRawMessage(message),
      sources: malformed,
      toolEvents: [],
      agentStatuses: [],
    });

    expect(first.sources).toBe(malformed);
    expect(second.sources).toBe(malformed);
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Failed to parse legacy array field from desktop storage',
      {
        fieldName: 'sources',
        preview: malformed,
      }
    );
  });
});
