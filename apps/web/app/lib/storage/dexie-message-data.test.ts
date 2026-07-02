import { describe, expect, it } from 'bun:test';
import type { StorageMessage } from '@taskforceai/persistence';
import type { ToolUsageEvent } from '@taskforceai/shared/types';

import { createDexieMessageData } from './dexie-message-data';

const createStorageMessage = (overrides: Partial<StorageMessage> = {}): StorageMessage =>
  ({
    messageId: 'msg-1',
    conversationId: 'conv-1',
    role: 'assistant',
    content: 'Hello',
    isStreaming: false,
    createdAt: 1760000000000,
    updatedAt: 1760000005000,
    deviceId: 'device-1',
    ...overrides,
  }) as StorageMessage;

describe('createDexieMessageData', () => {
  it('maps required message fields and applies local persistence defaults', () => {
    const result = createDexieMessageData(createStorageMessage());

    expect(result).toEqual({
      messageId: 'msg-1',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Hello',
      isStreaming: false,
      createdAt: 1760000000000,
      updatedAt: 1760000005000,
      syncVersion: 0,
      lastSyncedAt: 0,
      isDeleted: false,
      deviceId: 'device-1',
    });
  });

  it('preserves optional message metadata and mirrors traceId for legacy readers', () => {
    const sources = [{ url: 'https://example.com', title: 'Example' }];
    const toolEvents: ToolUsageEvent[] = [
      {
        agentLabel: 'Researcher',
        toolName: 'search',
        arguments: { query: 'docs' },
        success: true,
        durationMs: 125,
        resultPreview: 'Found docs',
      },
    ];
    const agentStatuses = [{ id: 'agent-1', status: 'completed' }];

    const result = createDexieMessageData(
      createStorageMessage({
        messageId: 'msg-2',
        conversationId: 'conv-2',
        content: 'Done',
        isStreaming: true,
        isAgentStatus: true,
        isLocalCommandOutput: false,
        elapsedSeconds: 3.5,
        createdAt: 1760000010000,
        updatedAt: 1760000015000,
        error: null,
        sources,
        toolEvents,
        agentStatuses,
        traceId: 'trace-1',
        syncVersion: 4,
        lastSyncedAt: 1760000020000,
        isDeleted: true,
      })
    );

    expect(result).toMatchObject({
      isAgentStatus: true,
      isLocalCommandOutput: false,
      elapsedSeconds: 3.5,
      error: null,
      sources,
      toolEvents,
      agentStatuses,
      traceId: 'trace-1',
      trace_id: 'trace-1',
      syncVersion: 4,
      lastSyncedAt: 1760000020000,
      isDeleted: true,
    });
  });
});
