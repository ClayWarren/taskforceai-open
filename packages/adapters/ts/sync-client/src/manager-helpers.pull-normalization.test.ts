import { describe, expect, it } from 'bun:test';

import {
  conversationResultError,
  createStorageMock,
  messageResultError,
} from '#tests/fixtures/sync-storage';
import { applyPullResponse, mapConflicts } from './manager-helpers';
import type { SyncPullResponse } from './types';

describe('sync-client/manager-helpers pull normalization', () => {
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

  it('skips malformed pull records and keeps invalid sync versions non-negative', async () => {
    const storage = createStorageMock();
    storage.getLastSyncVersion.mockResolvedValue(Number.NaN);
    const response: SyncPullResponse = {
      conversations: [
        {
          id: '   ',
          user_input: 'Missing id',
          timestamp: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          sync_version: 12,
          last_synced_at: new Date().toISOString(),
          is_deleted: false,
        } as unknown as SyncPullResponse['conversations'][number],
      ],
      messages: [
        {
          conversation_id: 4,
          role: 'assistant',
          content: 'missing message id',
          is_deleted: false,
        } as unknown as SyncPullResponse['messages'][number],
        {
          message_id: 'msg-bad-conversation',
          conversation_id: '4' as unknown as number,
          role: 'assistant',
          content: 'bad conversation id',
          is_streaming: false,
          is_agent_status: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error: undefined,
          sources: [],
          tool_events: [],
          sync_version: 12,
          last_synced_at: new Date().toISOString(),
          is_deleted: false,
        },
      ],
      deletions: [],
      latest_version: -1,
    };

    const stats = await applyPullResponse(storage, response);

    expect(stats).toEqual({ conversations: 0, messages: 0, deletions: 0 });
    expect(storage.upsertConversation).not.toHaveBeenCalled();
    expect(storage.upsertMessage).not.toHaveBeenCalled();
    expect(storage.setLastSyncVersion).toHaveBeenCalledWith(0);
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

  it('applies truncated pull content when local lookup throws', async () => {
    const storage = createStorageMock();
    storage.getConversation.mockRejectedValue(new Error('conversation lookup failed'));
    storage.getMessage.mockRejectedValue(new Error('message lookup failed'));
    const now = new Date().toISOString();

    const stats = await applyPullResponse(storage, {
      conversations: [
        {
          id: 5,
          user_input: 'Partial title',
          timestamp: now,
          updated_at: now,
          sync_version: 13,
          last_synced_at: now,
          is_deleted: false,
          content_truncated: true,
        },
      ],
      messages: [
        {
          message_id: 'msg-truncated-throw',
          conversation_id: 5,
          role: 'assistant',
          content: 'Compacted content',
          is_streaming: false,
          is_agent_status: false,
          created_at: now,
          updated_at: now,
          sync_version: 13,
          last_synced_at: now,
          is_deleted: false,
          content_truncated: true,
        },
      ],
      deletions: [],
      latest_version: 13,
    });

    expect(stats).toEqual({ conversations: 1, messages: 1, deletions: 0 });
    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'remote-5' })
    );
    expect(storage.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'msg-truncated-throw' })
    );
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

  it('maps conflicts from snake case, camel case, and malformed entries', () => {
    expect(
      mapConflicts({
        conflicts: [
          {
            type: 'message',
            id: 'msg-1',
            client_version: 2,
            server_version: 3,
            reason: 'newer on server',
          },
          {
            type: 'conversation',
            id: 'conv-1',
            clientVersion: 4,
            serverVersion: 5,
          } as unknown as never,
          'not-a-record' as never,
        ],
        accepted: [],
        conversation_id_mappings: {},
        latest_version: 5,
      } as unknown as Parameters<typeof mapConflicts>[0]) as unknown
    ).toEqual([
      {
        type: 'message',
        id: 'msg-1',
        localVersion: 2,
        serverVersion: 3,
        reason: 'newer on server',
      },
      {
        type: 'conversation',
        id: 'conv-1',
        localVersion: 4,
        serverVersion: 5,
        reason: '',
      },
      {
        type: undefined,
        id: undefined,
        localVersion: 0,
        serverVersion: 0,
        reason: '',
      },
    ]);
  });
});
