import type { PendingChange } from '@taskforceai/persistence';
import { describe, expect, it } from 'bun:test';

import {
  conversationResultError,
  createStorageMock,
  messageResultError,
} from '#tests/fixtures/sync-storage';
import {
  applyConversationIdMappings,
  applyPullResponse,
  buildPushPayload,
  clearAcceptedPendingChanges,
} from './manager-helpers';
import type { SyncPullResponse } from './types';

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

  it('normalizes malformed pull payload fields before writing to storage', async () => {
    const storage = createStorageMock();
    const response: SyncPullResponse = {
      conversations: [
        {
          id: 4,
          user_input: 'Pull title',
          timestamp: 'not-a-date',
          updated_at: 'still-not-a-date',
          result: 'Server result',
          sync_version: 2,
          last_synced_at: 'invalid',
          device_id: 'remote-device',
          is_deleted: false,
          is_archived: true,
        },
      ],
      messages: [
        {
          message_id: 'msg-4',
          conversation_id: 4,
          role: 'not-a-valid-role',
          content: 'Assistant answer',
          is_streaming: false,
          is_agent_status: false,
          created_at: 'bad-created-at',
          updated_at: 'bad-updated-at',
          sources: [
            { url: 'https://example.com/docs', title: 'Docs' },
            { title: 'Missing URL' },
            'invalid-source-item',
          ],
          tool_events: [
            {
              agentLabel: 'Planner',
              toolName: 'search',
              success: true,
              durationMs: 14,
              arguments: { q: 'sync' },
              sources: [{ url: 'https://example.com/result', title: 'Result' }],
            },
            { agentLabel: 'Planner', success: true, durationMs: 5 },
          ],
          agent_statuses: [
            {
              status: 'running',
              progress: 0.5,
              model: 'gemini-3.1-pro',
              reasoning: 'searching docs',
            },
            { progress: 0.9 },
          ],
          trace: { id: 'task-trace-4' },
          sync_version: 2,
          last_synced_at: 'bad-last-synced-at',
          device_id: 'remote-device',
          is_deleted: false,
        },
      ],
      deletions: [],
      latest_version: 12,
    };

    const stats = await applyPullResponse(storage, response);

    expect(stats).toEqual({
      conversations: 1,
      messages: 1,
      deletions: 0,
    });
    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'remote-4',
        title: 'Pull title',
        createdAt: 0,
        updatedAt: 0,
        lastSyncedAt: 0,
        isArchived: true,
      })
    );
    expect(storage.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-4',
        conversationId: 'remote-4',
        role: 'assistant',
        createdAt: 0,
        updatedAt: 0,
        lastSyncedAt: 0,
        sources: [{ url: 'https://example.com/docs', title: 'Docs' }],
        toolEvents: [
          {
            agentLabel: 'Planner',
            toolName: 'search',
            success: true,
            durationMs: 14,
            arguments: { q: 'sync' },
            sources: [{ url: 'https://example.com/result', title: 'Result' }],
          },
        ],
        agentStatuses: [
          {
            status: 'running',
            progress: 0.5,
            model: 'gemini-3.1-pro',
            reasoning: 'searching docs',
          },
        ],
        traceId: 'task-trace-4',
      })
    );
    expect(storage.setLastSyncVersion).toHaveBeenCalledWith(12);
  });

  it('normalizes conversation deletion IDs to remote-prefixed storage IDs', async () => {
    const storage = createStorageMock();
    const response: SyncPullResponse = {
      conversations: [],
      messages: [],
      deletions: [
        {
          type: 'conversation',
          id: '77',
          deleted_at: new Date().toISOString(),
        },
        {
          type: 'conversation',
          id: 'remote-88',
          deleted_at: new Date().toISOString(),
        },
      ],
      latest_version: 20,
    };

    await applyPullResponse(storage, response);

    expect(storage.deleteConversation).toHaveBeenCalledWith('remote-77');
    expect(storage.deleteConversation).toHaveBeenCalledWith('remote-88');
  });

  it('does not roll back sync version when pull payload latest_version is stale', async () => {
    const storage = createStorageMock();
    storage.getLastSyncVersion.mockResolvedValue(101);
    const response: SyncPullResponse = {
      conversations: [],
      messages: [],
      deletions: [],
      latest_version: 100,
    };

    await applyPullResponse(storage, response);

    expect(storage.setLastSyncVersion).toHaveBeenCalledWith(101);
  });

  it('applies truncated pull content when no local copy exists', async () => {
    const storage = createStorageMock();
    storage.getConversation.mockResolvedValue(conversationResultError(new Error('missing')));
    storage.getMessage.mockResolvedValue(messageResultError(new Error('missing')));
    const now = new Date().toISOString();
    const response: SyncPullResponse = {
      conversations: [
        {
          id: 4,
          user_input: 'Partial title',
          timestamp: now,
          updated_at: now,
          sync_version: 12,
          last_synced_at: now,
          is_deleted: false,
          content_truncated: true,
        },
      ],
      messages: [
        {
          message_id: 'msg-truncated',
          conversation_id: 4,
          role: 'assistant',
          content: 'Compacted content still present',
          is_streaming: false,
          is_agent_status: false,
          created_at: now,
          updated_at: now,
          sync_version: 12,
          last_synced_at: now,
          is_deleted: false,
          content_truncated: true,
        },
      ],
      deletions: [],
      latest_version: 12,
    };

    const stats = await applyPullResponse(storage, response);

    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'remote-4',
        title: 'Partial title',
      })
    );
    expect(storage.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-truncated',
        conversationId: 'remote-4',
        content: 'Compacted content still present',
      })
    );
    expect(storage.setLastSyncVersion).toHaveBeenCalledWith(12);
    expect(stats).toEqual({ conversations: 1, messages: 1, deletions: 0 });
  });

  it('does not overwrite existing records with truncated pull content', async () => {
    const storage = createStorageMock();
    const now = new Date().toISOString();
    const response: SyncPullResponse = {
      conversations: [
        {
          id: 4,
          user_input: 'Partial title',
          timestamp: now,
          updated_at: now,
          sync_version: 12,
          last_synced_at: now,
          is_deleted: false,
          content_truncated: true,
        },
      ],
      messages: [
        {
          message_id: 'msg-truncated',
          conversation_id: 4,
          role: 'assistant',
          content: 'Compacted content',
          is_streaming: false,
          is_agent_status: false,
          created_at: now,
          updated_at: now,
          sync_version: 12,
          last_synced_at: now,
          is_deleted: false,
          content_truncated: true,
        },
      ],
      deletions: [],
      latest_version: 12,
    };

    const stats = await applyPullResponse(storage, response);

    expect(storage.upsertConversation).not.toHaveBeenCalled();
    expect(storage.upsertMessage).not.toHaveBeenCalled();
    expect(storage.setLastSyncVersion).toHaveBeenCalledWith(12);
    expect(stats).toEqual({ conversations: 0, messages: 0, deletions: 0 });
  });

  it('drops malformed conversation upserts without creating remote-undefined', async () => {
    const storage = createStorageMock();
    const response: SyncPullResponse = {
      conversations: [
        {
          user_input: 'Missing id',
          timestamp: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          sync_version: 12,
          last_synced_at: new Date().toISOString(),
          is_deleted: false,
        } as SyncPullResponse['conversations'][number],
      ],
      messages: [],
      deletions: [],
      latest_version: 12,
    };

    await applyPullResponse(storage, response);

    expect(storage.upsertConversation).not.toHaveBeenCalled();
    expect(storage.setLastSyncVersion).toHaveBeenCalledWith(12);
  });
});
