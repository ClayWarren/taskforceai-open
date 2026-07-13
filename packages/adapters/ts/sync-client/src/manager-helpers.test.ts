import type { PendingChange } from '@taskforceai/persistence';
import { describe, expect, it } from 'bun:test';

import { createStorageMock } from '#tests/fixtures/sync-storage';
import {
  applyConversationIdMappings,
  applyPendingMessageConversationMappings,
  buildPushPayload,
  clearAcceptedPendingChanges,
  clearInvalidPendingChanges,
} from './manager-helpers';

describe('sync-client/manager-helpers', () => {
  it('drops invalid message payloads when building push payload', async () => {
    const now = Date.now();
    const pending: PendingChange[] = [
      {
        id: 1,
        type: 'message',
        entityId: 'msg-not-record',
        operation: 'create',
        data: null,
        createdAt: now,
      },
      {
        id: 2,
        type: 'message',
        entityId: 'msg-empty-content',
        operation: 'create',
        data: {
          messageId: 'msg-empty-content',
          conversationId: 'remote-10',
          content: '',
        },
        createdAt: now,
      },
      {
        id: 3,
        type: 'message',
        entityId: 'msg-invalid-conversation',
        operation: 'create',
        data: {
          messageId: 'msg-invalid-conversation',
          conversationId: 'remote-0',
          content: 'should drop',
        },
        createdAt: now,
      },
      {
        id: 4,
        type: 'message',
        entityId: '',
        operation: 'create',
        data: {
          conversationId: 'remote-22',
          content: 'missing message id',
        },
        createdAt: now,
      },
      {
        id: 5,
        type: 'message',
        entityId: 'valid-message',
        operation: 'create',
        data: {
          conversationId: 'remote-88',
          content: 'valid payload',
          isStreaming: true,
          createdAt: now - 2000,
          updatedAt: now - 1000,
          lastSyncedAt: now - 500,
        },
        createdAt: now,
      },
      {
        id: 6,
        type: 'message',
        entityId: 'valid-agent-status',
        operation: 'create',
        data: {
          conversationId: 'remote-88',
          content: '',
          isAgentStatus: true,
          isStreaming: false,
          agentStatuses: [{ status: 'COMPLETED', model: 'Sentinel' }],
          toolEvents: [
            {
              agentLabel: 'Sentinel',
              toolName: 'search_web',
              arguments: { query: 'launch readiness' },
              success: true,
              durationMs: 120,
              sources: [{ url: 'https://example.com/source', title: 'Source' }],
            },
          ],
          sources: [{ url: 'https://example.com/source', title: 'Source' }],
          createdAt: now - 2000,
          updatedAt: now - 1000,
        },
        createdAt: now,
      },
    ];

    const payload = await buildPushPayload(pending, 'device-42');

    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[0]).toEqual(
      expect.objectContaining({
        message_id: 'valid-message',
        conversation_id: 88,
        role: 'assistant',
        content: 'valid payload',
        is_streaming: true,
        is_agent_status: false,
        device_id: 'device-42',
        sync_version: 0,
        is_deleted: false,
      })
    );
    expect(payload.messages[1]).toEqual(
      expect.objectContaining({
        message_id: 'valid-agent-status',
        conversation_id: 88,
        role: 'assistant',
        content: '',
        is_streaming: false,
        is_agent_status: true,
        agent_statuses: [{ status: 'COMPLETED', model: 'Sentinel' }],
        tool_events: [
          {
            agentLabel: 'Sentinel',
            toolName: 'search_web',
            arguments: { query: 'launch readiness' },
            success: true,
            durationMs: 120,
            sources: [{ url: 'https://example.com/source', title: 'Source' }],
          },
        ],
        sources: [{ url: 'https://example.com/source', title: 'Source' }],
      })
    );
  });

  it('encodes remote conversation entity IDs as numeric server IDs in push payload', async () => {
    const now = Date.now();
    const pending: PendingChange[] = [
      {
        id: 6,
        type: 'conversation',
        entityId: 'remote-42',
        operation: 'create',
        data: { prompt: 'Update existing remote conversation' },
        createdAt: now,
      },
      {
        id: 7,
        type: 'conversation',
        entityId: 'local-7',
        operation: 'create',
        data: { prompt: 'Create new local conversation', isArchived: true },
        createdAt: now,
      },
    ];

    const payload = await buildPushPayload(pending, 'device-42');
    expect(payload.conversations).toHaveLength(2);

    const remotePayload = payload.conversations[0];
    if (!remotePayload) {
      throw new Error('Expected remote conversation payload to be present');
    }
    expect(remotePayload).toMatchObject({
      id: 42,
      user_input: 'Update existing remote conversation',
    });
    expect(remotePayload.local_id).toBeUndefined();

    expect(payload.conversations[1]).toMatchObject({
      local_id: 'local-7',
      user_input: 'Create new local conversation',
      is_archived: true,
    });
  });

  it('ignores prompt pending changes when building push payload', async () => {
    const now = Date.now();
    const pending: PendingChange[] = [
      {
        id: 8,
        type: 'prompt',
        entityId: 'conv-8',
        operation: 'create',
        data: { prompt: 'queued-only prompt', status: 'queued' },
        createdAt: now,
      },
      {
        id: 9,
        type: 'conversation',
        entityId: 'local-9',
        operation: 'create',
        data: { prompt: 'sync conversation' },
        createdAt: now,
      },
    ];

    const payload = await buildPushPayload(pending, 'device-42');

    expect(payload.conversations).toHaveLength(1);
    expect(payload.conversations[0]).toMatchObject({
      local_id: 'local-9',
      user_input: 'sync conversation',
    });
    expect(payload.messages).toHaveLength(0);
    expect(payload.deletions).toHaveLength(0);
  });

  it('uses deletion type hints and defaults to conversation for malformed deletion data', async () => {
    const now = Date.now();
    const pending: PendingChange[] = [
      {
        id: 10,
        type: 'deletion',
        entityId: 'msg-10',
        operation: 'delete',
        data: { entityType: 'message' },
        createdAt: now,
      },
      {
        id: 11,
        type: 'deletion',
        entityId: 'conv-11',
        operation: 'delete',
        data: 'not-an-object',
        createdAt: now,
      },
    ];

    const payload = await buildPushPayload(pending, 'device-42');

    expect(payload.deletions).toEqual([
      expect.objectContaining({ id: 'msg-10', type: 'message' }),
      expect.objectContaining({ id: 'conv-11', type: 'conversation' }),
    ]);
  });

  it('preserves explicit conversation deletion changes in push payloads', async () => {
    const now = Date.now();
    const payload = await buildPushPayload(
      [
        {
          id: 12,
          type: 'conversation',
          entityId: 'remote-12',
          operation: 'delete',
          data: {},
          createdAt: now,
        },
      ],
      'device-42'
    );

    expect(payload.deletions).toEqual([
      expect.objectContaining({
        id: 'remote-12',
        type: 'conversation',
        deleted_at: new Date(now).toISOString(),
      }),
    ]);
  });

  it('normalizes numeric and string conversation ids in message push payloads', async () => {
    const now = Date.now();
    const payload = await buildPushPayload(
      [
        {
          id: 13,
          type: 'message',
          entityId: 'msg-number-conversation',
          operation: 'create',
          data: {
            conversationId: 99,
            content: 'numeric conversation',
            createdAt: new Date(now).toISOString(),
          },
          createdAt: now,
        },
        {
          id: 14,
          type: 'message',
          entityId: 'msg-string-conversation',
          operation: 'create',
          data: {
            conversationId: '100',
            content: 'string conversation',
          },
          createdAt: now,
        },
      ],
      'device-42'
    );

    expect(payload.messages.map((message) => message.conversation_id)).toEqual([99, 100]);
    expect(payload.messages[0]?.created_at).toBe(new Date(now).toISOString());
  });

  it('preserves deleted message updates with empty content in push payloads', async () => {
    const now = Date.now();
    const payload = await buildPushPayload(
      [
        {
          id: 15,
          type: 'message',
          entityId: 'msg-deleted-update',
          operation: 'update',
          data: {
            messageId: 'msg-deleted-update',
            conversationId: 'remote-101',
            content: '',
            isDeleted: true,
          },
          createdAt: now,
        },
      ],
      'device-42'
    );

    expect(payload.messages).toEqual([
      expect.objectContaining({
        message_id: 'msg-deleted-update',
        conversation_id: 101,
        content: '',
        is_deleted: true,
      }),
    ]);
    expect(payload.invalidPendingChanges).toEqual([]);
  });

  it('reports invalid message pending changes that cannot be converted to payloads', async () => {
    const now = Date.now();
    const payload = await buildPushPayload(
      [
        {
          id: 16,
          type: 'message',
          entityId: 'msg-invalid-data',
          operation: 'create',
          data: null,
          createdAt: now,
        },
        {
          id: 17,
          type: 'message',
          entityId: 'msg-local-conversation',
          operation: 'create',
          data: {
            messageId: 'msg-local-conversation',
            conversationId: 'local-17',
            content: 'waiting for mapping',
          },
          createdAt: now,
        },
      ],
      'device-42'
    );

    expect(payload.messages).toEqual([]);
    expect(payload.invalidPendingChanges).toEqual([
      {
        id: 16,
        type: 'message',
        entityId: 'msg-invalid-data',
        reason: 'invalid_message_data',
      },
      {
        id: 17,
        type: 'message',
        entityId: 'msg-local-conversation',
        reason: 'invalid_conversation_id',
      },
    ]);
  });

  it('omits invalid pending changes that do not have persisted ids', async () => {
    const payload = await buildPushPayload(
      [
        {
          type: 'message',
          entityId: 'msg-without-persisted-id',
          operation: 'create',
          data: null,
          createdAt: Date.now(),
        },
      ],
      'device-42'
    );

    expect(payload.messages).toEqual([]);
    expect(payload.invalidPendingChanges).toEqual([]);
  });

  it('skips conversation mapping when the local id already matches target remote id', async () => {
    const storage = createStorageMock();

    await applyConversationIdMappings(storage, {
      'remote-7': 7,
      'local-3': 9,
    });

    expect(storage.replaceConversationId).toHaveBeenCalledTimes(1);
    expect(storage.replaceConversationId).toHaveBeenCalledWith('local-3', 'remote-9');
  });

  it('skips conversation mapping when server returns a remote-prefixed local key', async () => {
    const storage = createStorageMock();

    await applyConversationIdMappings(storage, {
      'remote-7': 99,
      'local-2': 9,
    });

    expect(storage.replaceConversationId).toHaveBeenCalledTimes(1);
    expect(storage.replaceConversationId).toHaveBeenCalledWith('local-2', 'remote-9');
  });

  it('ignores invalid conversation mapping payloads', async () => {
    const storage = createStorageMock();

    await applyConversationIdMappings(storage, {
      'local-null': null,
      'local-object': { id: 3 },
      'local-valid': '11',
    } as unknown as Record<string, number | string>);

    expect(storage.replaceConversationId).toHaveBeenCalledTimes(1);
    expect(storage.replaceConversationId).toHaveBeenCalledWith('local-valid', 'remote-11');
  });

  it('clears accepted pending changes by typed id and entity id fallback', async () => {
    const storage = createStorageMock();
    const pending: PendingChange[] = [
      {
        id: 21,
        type: 'conversation',
        entityId: 'conv-21',
        operation: 'create',
        data: {},
        createdAt: Date.now(),
      },
      {
        type: 'message',
        entityId: 'msg-without-db-id',
        operation: 'update',
        data: {},
        createdAt: Date.now(),
      },
      {
        id: 22,
        type: 'message',
        entityId: 'msg-22',
        operation: 'update',
        data: {},
        createdAt: Date.now(),
      },
    ];

    await clearAcceptedPendingChanges(storage, pending, [
      'conversation:conv-21',
      'msg-22',
      'message:unknown',
      'msg-without-db-id',
    ]);

    expect(storage.removePendingChange).toHaveBeenCalledTimes(2);
    expect(storage.removePendingChange).toHaveBeenCalledWith(21);
    expect(storage.removePendingChange).toHaveBeenCalledWith(22);
  });

  it('does not clear ambiguous pending changes when accepted id has no type prefix', async () => {
    const storage = createStorageMock();
    const pending: PendingChange[] = [
      {
        id: 31,
        type: 'conversation',
        entityId: 'shared-entity',
        operation: 'update',
        data: {},
        createdAt: Date.now(),
      },
      {
        id: 32,
        type: 'message',
        entityId: 'shared-entity',
        operation: 'update',
        data: {},
        createdAt: Date.now(),
      },
    ];

    await clearAcceptedPendingChanges(storage, pending, ['shared-entity']);

    expect(storage.removePendingChange).not.toHaveBeenCalled();
  });

  it('ignores prompt pending changes when clearing accepted conversation changes', async () => {
    const storage = createStorageMock();
    const pending: PendingChange[] = [
      {
        id: 31,
        type: 'prompt',
        entityId: 'remote-42',
        operation: 'create',
        data: { prompt: 'queued prompt', status: 'queued' },
        createdAt: Date.now(),
      },
      {
        id: 32,
        type: 'conversation',
        entityId: 'remote-42',
        operation: 'create',
        data: { prompt: 'real conversation change' },
        createdAt: Date.now(),
      },
    ];

    await clearAcceptedPendingChanges(storage, pending, ['42']);

    expect(storage.removePendingChange).toHaveBeenCalledTimes(1);
    expect(storage.removePendingChange).toHaveBeenCalledWith(32);
  });

  it('matches remote-prefixed conversation entity IDs when accepted ID is numeric', async () => {
    const storage = createStorageMock();
    const pending: PendingChange[] = [
      {
        id: 33,
        type: 'conversation',
        entityId: 'remote-33',
        operation: 'update',
        data: {},
        createdAt: Date.now(),
      },
    ];

    await clearAcceptedPendingChanges(storage, pending, ['conversation:33']);

    expect(storage.removePendingChange).toHaveBeenCalledTimes(1);
    expect(storage.removePendingChange).toHaveBeenCalledWith(33);
  });

  it('ignores blank accepted conversation IDs after type prefixes', async () => {
    const storage = createStorageMock();
    const pending: PendingChange[] = [
      {
        id: 36,
        type: 'conversation',
        entityId: 'remote-36',
        operation: 'update',
        data: {},
        createdAt: Date.now(),
      },
    ];

    await clearAcceptedPendingChanges(storage, pending, ['conversation: ']);

    expect(storage.removePendingChange).not.toHaveBeenCalled();
  });

  it('does not clear untyped remote-prefixed accepted IDs that match multiple pending types', async () => {
    const storage = createStorageMock();
    const pending: PendingChange[] = [
      {
        id: 34,
        type: 'conversation',
        entityId: 'remote-34',
        operation: 'update',
        data: {},
        createdAt: Date.now(),
      },
      {
        id: 35,
        type: 'message',
        entityId: 'remote-34',
        operation: 'update',
        data: {},
        createdAt: Date.now(),
      },
    ];

    await clearAcceptedPendingChanges(storage, pending, ['remote-34']);

    expect(storage.removePendingChange).not.toHaveBeenCalled();
  });

  it('clears duplicate accepted pending changes in stable order without duplicates', async () => {
    const storage = createStorageMock();
    const pending: PendingChange[] = [
      {
        id: 41,
        type: 'message',
        entityId: 'msg-41',
        operation: 'update',
        data: {},
        createdAt: Date.now(),
      },
      {
        id: 42,
        type: 'message',
        entityId: 'msg-41',
        operation: 'update',
        data: {},
        createdAt: Date.now(),
      },
      {
        id: 43,
        type: 'conversation',
        entityId: 'remote-43',
        operation: 'update',
        data: {},
        createdAt: Date.now(),
      },
    ];

    await clearAcceptedPendingChanges(storage, pending, ['msg-41', 'msg-41', 'conversation:43']);

    expect(storage.removePendingChange).toHaveBeenCalledTimes(3);
    expect(storage.removePendingChange).toHaveBeenNthCalledWith(1, 41);
    expect(storage.removePendingChange).toHaveBeenNthCalledWith(2, 42);
    expect(storage.removePendingChange).toHaveBeenNthCalledWith(3, 43);
  });

  it('clears delete-operation pending changes from deletion accepted ids', async () => {
    const storage = createStorageMock();
    const pending: PendingChange[] = [
      {
        id: 44,
        type: 'conversation',
        entityId: 'remote-44',
        operation: 'delete',
        data: {},
        createdAt: Date.now(),
      },
      {
        id: 45,
        type: 'message',
        entityId: 'msg-45',
        operation: 'delete',
        data: {},
        createdAt: Date.now(),
      },
    ];

    await clearAcceptedPendingChanges(storage, pending, ['deletion:44', 'deletion:msg-45']);

    expect(storage.removePendingChange).toHaveBeenCalledTimes(2);
    expect(storage.removePendingChange).toHaveBeenCalledWith(44);
    expect(storage.removePendingChange).toHaveBeenCalledWith(45);
  });

  it('updates pending message conversation ids from accepted conversation mappings', async () => {
    const storage = createStorageMock();
    const pending: PendingChange[] = [
      {
        id: 46,
        type: 'message',
        entityId: 'msg-46',
        operation: 'create',
        data: {
          messageId: 'msg-46',
          conversationId: 'local-46',
          content: 'mapped on next sync',
        },
        createdAt: Date.now(),
      },
    ];

    const retained = await applyPendingMessageConversationMappings(storage, pending, {
      'local-46': 146,
    });

    expect(retained).toEqual(new Set([46]));
    expect(storage.updatePendingChangeData).toHaveBeenCalledWith(46, {
      messageId: 'msg-46',
      conversationId: 'remote-146',
      conversationLocalId: 'local-46',
      content: 'mapped on next sync',
    });
  });

  it('removes invalid pending changes while retaining newly mapped messages', async () => {
    const storage = createStorageMock();

    await clearInvalidPendingChanges(
      storage,
      [
        {
          id: 47,
          type: 'message',
          entityId: 'msg-remove',
          reason: 'invalid_message_data',
        },
        {
          id: 48,
          type: 'message',
          entityId: 'msg-retain',
          reason: 'invalid_conversation_id',
        },
      ],
      new Set([48])
    );

    expect(storage.removePendingChange).toHaveBeenCalledTimes(1);
    expect(storage.removePendingChange).toHaveBeenCalledWith(47);
  });
});
