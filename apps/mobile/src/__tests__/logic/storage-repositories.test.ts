import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  asyncStorageState,
  baseConversationRow,
  baseMessageRow,
  dbManagerState,
  makeJwtWithExp,
  ormState,
  resetMockState,
  secureStoreState,
} from './storage-repositories.test-harness';

const { ConversationRepository } = require(
  '../../storage/repositories/ConversationRepository'
) as typeof import('../../storage/repositories/ConversationRepository');
const { MessageRepository } = require(
  '../../storage/repositories/MessageRepository'
) as typeof import('../../storage/repositories/MessageRepository');
const { SyncRepository } = require(
  '../../storage/repositories/SyncRepository'
) as typeof import('../../storage/repositories/SyncRepository');
const { SessionRepository } = require(
  '../../storage/repositories/SessionRepository'
) as typeof import('../../storage/repositories/SessionRepository');
const { UserRepository } = require(
  '../../storage/repositories/UserRepository'
) as typeof import('../../storage/repositories/UserRepository');
const { createProfileData, createProfileRow, createSessionRow } = require(
  './storage-repositories.fixtures'
) as typeof import('./storage-repositories.fixtures');

describe('storage repositories', () => {
  beforeEach(() => {
    resetMockState();
  });

  afterAll(() => {
    mock.restore();
  });

  it('ConversationRepository falls back when is_deleted column is missing', async () => {
    ormState.selectPlans.push(
      { throwAtWhere: new Error('no such column: conversations.is_deleted') },
      { rows: [baseConversationRow] }
    );

    const repo = new ConversationRepository();
    const rows = await repo.getConversations(5, 2);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      conversationId: 'conv-1',
      title: 'Title',
      isDeleted: false,
    });
    expect(dbManagerState.ensureOrmCalls).toBe(2);
    expect(ormState.selectRecords[0]?.whereCalled).toBe(true);
    expect(ormState.selectRecords[1]?.whereCalled).toBe(false);
    expect(ormState.selectRecords[1]?.limit).toBe(5);
    expect(ormState.selectRecords[1]?.offset).toBe(2);
  });

  it('ConversationRepository lists archived conversations separately', async () => {
    ormState.selectPlans.push({
      rows: [
        {
          ...baseConversationRow,
          conversationId: 'archived-1',
          title: 'Archived',
          isArchived: true,
        },
      ],
    });

    const repo = new ConversationRepository();
    const rows = await repo.getArchivedConversations(10, 4);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      conversationId: 'archived-1',
      isArchived: true,
    });
    expect(ormState.selectRecords[0]?.whereCalled).toBe(true);
    expect(ormState.selectRecords[0]?.limit).toBe(10);
    expect(ormState.selectRecords[0]?.offset).toBe(4);
  });

  it('ConversationRepository returns no archived rows when archive column is missing', async () => {
    ormState.selectPlans.push({
      throwAtWhere: new Error('no such column: conversations.is_archived'),
    });

    const repo = new ConversationRepository();
    const rows = await repo.getArchivedConversations();

    expect(rows).toEqual([]);
  });

  it('ConversationRepository rethrows unexpected list errors', async () => {
    ormState.selectPlans.push({ throwAtWhere: new Error('read failed') });
    const repo = new ConversationRepository();

    await expect(repo.getConversations()).rejects.toThrow('read failed');

    ormState.selectPlans.push({ throwAtWhere: new Error('archive read failed') });
    await expect(repo.getArchivedConversations()).rejects.toThrow('archive read failed');
  });

  it('ConversationRepository returns found and missing conversation results', async () => {
    ormState.selectPlans.push({ rows: [baseConversationRow] }, { rows: [] });
    const repo = new ConversationRepository();

    const found = await repo.getConversation('conv-1');
    const missing = await repo.getConversation('missing-conv');

    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value).toMatchObject({ conversationId: 'conv-1', title: 'Title' });
    }
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.message).toContain('not found');
    }
    expect(ormState.selectRecords[0]?.limit).toBe(1);
    expect(ormState.selectRecords[1]?.limit).toBe(1);
  });

  it('ConversationRepository persists archive state and supports bulk archive/delete', async () => {
    const repo = new ConversationRepository();

    await repo.upsertConversation({
      conversationId: 'conv-archived',
      title: 'Archived',
      createdAt: 1,
      updatedAt: 2,
      lastMessagePreview: null,
      syncVersion: 0,
      lastSyncedAt: 0,
      isDeleted: false,
      isArchived: true,
    });
    await repo.archiveAllConversations();
    await repo.deleteAllConversations();

    expect(ormState.insertValues[0]?.payload).toMatchObject({ isArchived: true });
    expect(ormState.insertConflictSets[0]?.payload).toMatchObject({ isArchived: true });
    expect(ormState.updateSets[0]?.payload).toMatchObject({ isArchived: true });
    expect(ormState.transactionCalls).toBe(1);
    expect(ormState.deleteTables).toHaveLength(2);
  });

  it('ConversationRepository deletes a conversation and its messages in one transaction', async () => {
    const repo = new ConversationRepository();

    await repo.deleteConversation('conv-delete');

    expect(ormState.transactionCalls).toBe(1);
    expect(ormState.deleteTables).toHaveLength(2);
    expect(ormState.deleteWhereCount).toBe(2);
  });

  it('ConversationRepository skips update query when no metadata fields are provided', async () => {
    const repo = new ConversationRepository();

    await repo.updateConversationMetadata('conv-1', {});

    expect(ormState.updateSets).toHaveLength(0);
    expect(ormState.updateWhereCount).toBe(0);
  });

  it('ConversationRepository writes provided metadata fields only', async () => {
    const repo = new ConversationRepository();

    await repo.updateConversationMetadata('conv-1', {
      updatedAt: 99,
      lastMessagePreview: null,
      title: 'Renamed',
    });

    expect(ormState.updateSets[0]?.payload).toEqual({
      updatedAt: 99,
      lastMessagePreview: null,
      title: 'Renamed',
    });
    expect(ormState.updateWhereCount).toBe(1);
  });

  it('ConversationRepository replaces conversation IDs in both tables within a transaction', async () => {
    const repo = new ConversationRepository();

    await repo.replaceConversationId('old-conv', 'new-conv');

    expect(ormState.transactionCalls).toBe(1);
    expect(ormState.updateSets).toHaveLength(2);
    expect(ormState.updateSets[0]?.payload).toEqual({ conversationId: 'new-conv' });
    expect(ormState.updateSets[1]?.payload).toEqual({ conversationId: 'new-conv' });
    expect(ormState.updateWhereCount).toBe(2);
  });

  it('MessageRepository normalizes invalid role/data and applies pagination', async () => {
    ormState.selectPlans.push({
      rows: [
        {
          ...baseMessageRow,
          metadata: JSON.stringify({
            traceId: 'trace-1',
            isLocalCommandOutput: true,
          }),
        },
      ],
    });
    const repo = new MessageRepository();

    const rows = await repo.getMessages('conv-1', 10, 3);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      messageId: 'msg-1',
      role: 'user',
      isStreaming: true,
      isAgentStatus: false,
      traceId: 'trace-1',
      isLocalCommandOutput: true,
    });
    expect(rows[0]?.sources).toEqual([]);
    expect(rows[0]?.toolEvents).toEqual([]);
    expect(rows[0]?.agentStatuses).toEqual([]);
    expect(ormState.selectRecords[0]?.whereCalled).toBe(true);
    expect(ormState.selectRecords[0]?.limit).toBe(10);
    expect(ormState.selectRecords[0]?.offset).toBe(3);
  });

  it('MessageRepository loads messages without pagination when no limit is provided', async () => {
    ormState.selectPlans.push({
      rows: [
        {
          ...baseMessageRow,
          role: 'assistant',
          isStreaming: 0,
          isAgentStatus: 1,
          sources: '[]',
          toolEvents: '[]',
          agentStatuses: '[]',
        },
      ],
    });
    const repo = new MessageRepository();

    const rows = await repo.getMessages('conv-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      messageId: 'msg-1',
      role: 'assistant',
      isStreaming: false,
      isAgentStatus: true,
    });
    expect(ormState.selectRecords[0]?.whereCalled).toBe(true);
    expect(ormState.selectRecords[0]?.orderByCalled).toBe(true);
    expect(ormState.selectRecords[0]?.limit).toBeUndefined();
    expect(ormState.selectRecords[0]?.offset).toBeUndefined();
  });

  it('MessageRepository serializes structured payloads during upsert', async () => {
    const repo = new MessageRepository();
    const message = {
      messageId: 'msg-9',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'response',
      isStreaming: false,
      isAgentStatus: true,
      elapsedSeconds: 4.5,
      createdAt: 1000,
      updatedAt: 1100,
      error: null,
      sources: [{ title: 'source' }],
      toolEvents: [{ event: 'tool' }],
      agentStatuses: [{ status: 'done' }],
      traceId: 'trace-9',
      isLocalCommandOutput: true,
      syncVersion: 2,
      lastSyncedAt: 999,
      deviceId: 'device-7',
      isDeleted: true,
    } as any;

    await repo.upsertMessage(message);

    expect(ormState.insertValues).toHaveLength(1);
    expect(ormState.insertValues[0]?.payload).toMatchObject({
      messageId: 'msg-9',
      content: 'response',
      sources: JSON.stringify(message.sources),
      toolEvents: JSON.stringify(message.toolEvents),
      agentStatuses: JSON.stringify(message.agentStatuses),
      metadata: JSON.stringify({
        traceId: 'trace-9',
        isLocalCommandOutput: true,
      }),
      isDeleted: true,
    });
    expect(ormState.insertConflictSets).toHaveLength(1);
    expect(ormState.insertConflictSets[0]?.payload).toMatchObject({
      content: 'response',
      sources: JSON.stringify(message.sources),
      metadata: JSON.stringify({
        traceId: 'trace-9',
        isLocalCommandOutput: true,
      }),
    });
  });

  it('MessageRepository returns an error result when a message is missing', async () => {
    ormState.queryMessageRow = undefined;
    const repo = new MessageRepository();

    const result = await repo.getMessage('missing-message');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('not found');
    }
  });

  it('MessageRepository deletes by message id', async () => {
    const repo = new MessageRepository();

    await repo.deleteMessage('msg-delete');

    expect(ormState.deleteTables).toHaveLength(1);
    expect(ormState.deleteWhereCount).toBe(1);
  });

  it('SyncRepository normalizes invalid pending change rows', async () => {
    ormState.selectPlans.push({
      rows: [
        {
          id: 9,
          type: 'unknown-type',
          entityId: 'entity-1',
          operation: 'invalid-op',
          data: '{bad json',
          createdAt: 123,
        },
      ],
    });
    const repo = new SyncRepository();

    const rows = await repo.getPendingChanges();

    expect(rows).toEqual([
      {
        id: 9,
        type: 'conversation',
        entityId: 'entity-1',
        operation: 'update',
        data: {},
        createdAt: 123,
      },
    ]);
  });

  it('SyncRepository writes, updates, removes, and clears pending changes', async () => {
    const repo = new SyncRepository();

    await repo.addPendingChange({
      type: 'message',
      entityId: 'msg-1',
      operation: 'create',
      data: { content: 'hello' },
      createdAt: 456,
    });
    await repo.updatePendingChange(7, { retry: true });
    await repo.updatePendingChangeData(8, undefined);
    await repo.removePendingChange(9);
    await repo.clearPendingChanges();

    expect(ormState.insertValues[0]?.payload).toEqual({
      type: 'message',
      entityId: 'msg-1',
      operation: 'create',
      data: JSON.stringify({ content: 'hello' }),
      createdAt: 456,
    });
    expect(ormState.updateSets.map((entry) => entry.payload)).toEqual([
      { data: JSON.stringify({ retry: true }) },
      { data: '{}' },
    ]);
    expect(ormState.updateWhereCount).toBe(2);
    expect(ormState.deleteWhereCount).toBe(1);
    expect(ormState.deleteTables).toHaveLength(2);
  });

  it('SyncRepository reads stored sync version metadata', async () => {
    asyncStorageState.values.set(
      '@taskforceai:sync_metadata',
      JSON.stringify({ lastSyncVersion: 84 })
    );
    const repo = new SyncRepository();

    expect(await repo.getLastSyncVersion()).toBe(84);

    asyncStorageState.values.set(
      '@taskforceai:sync_metadata',
      JSON.stringify({ lastSyncedAt: 123 })
    );
    expect(await repo.getLastSyncVersion()).toBe(0);
  });

  it('SyncRepository handles malformed metadata and storage errors when loading sync version', async () => {
    asyncStorageState.values.set('@taskforceai:sync_metadata', '{bad json');
    const repo = new SyncRepository();

    expect(await repo.getLastSyncVersion()).toBe(0);

    asyncStorageState.throwOnGet = new Error('read failed');
    expect(await repo.getLastSyncVersion()).toBe(0);
  });

  it('SyncRepository persists last sync version metadata', async () => {
    const repo = new SyncRepository();
    const before = Date.now();

    await repo.setLastSyncVersion(42);

    expect(asyncStorageState.setCalls).toHaveLength(1);
    expect(asyncStorageState.setCalls[0]?.key).toBe('@taskforceai:sync_metadata');
    const parsed = JSON.parse(asyncStorageState.setCalls[0]?.value ?? '{}') as {
      lastSyncVersion?: number;
      lastSyncedAt?: number;
    };
    expect(parsed.lastSyncVersion).toBe(42);
    expect(typeof parsed.lastSyncedAt).toBe('number');
    expect((parsed.lastSyncedAt ?? 0) >= before).toBe(true);
  });

  it('SessionRepository maps invalid stored plans to free', async () => {
    secureStoreState.token = 'token-123';
    ormState.selectPlans.push({
      rows: [
        createSessionRow({
          plan: 'enterprise',
        }),
      ],
    });
    const repo = new SessionRepository();

    const result = await repo.getSession();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.accessToken).toBe('token-123');
      expect(result.value.user.plan).toBe('free');
    }
  });

  it('SessionRepository clears expired sessions', async () => {
    secureStoreState.token = 'expired-token';
    ormState.selectPlans.push({
      rows: [
        createSessionRow({
          id: 2,
          expiresAt: Date.now() - 1_000,
          userId: 'user-2',
          email: 'expired@example.com',
          plan: 'pro',
        }),
      ],
    });
    const repo = new SessionRepository();

    const result = await repo.getSession();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('expired');
    }
    expect(secureStoreState.deleteCalls).toContain('taskforceai_auth_token');
    expect(ormState.deleteTables.length).toBeGreaterThan(0);
  });

  it('SessionRepository uses JWT exp claim when stored DB expiry is stale', async () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 7200;
    secureStoreState.token = makeJwtWithExp(expSeconds);
    ormState.selectPlans.push({
      rows: [
        createSessionRow({
          id: 3,
          expiresAt: Date.now() - 1_000,
          userId: 'user-3',
          email: 'valid-jwt@example.com',
          plan: 'pro',
        }),
      ],
    });
    const repo = new SessionRepository();

    const result = await repo.getSession();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.expiresAt).toBe(expSeconds * 1000);
      expect(result.value.user.email).toBe('valid-jwt@example.com');
    }
    expect(secureStoreState.deleteCalls).toHaveLength(0);
  });

  it('SessionRepository writes keychain token and placeholder DB value on setSession', async () => {
    const repo = new SessionRepository();
    const session = {
      accessToken: 'new-token',
      expiresAt: Date.now() + 120_000,
      user: {
        id: 77,
        email: 'new@example.com',
        plan: 'pro',
      },
    } as any;

    const result = await repo.setSession(session);

    expect(result.ok).toBe(true);
    expect(ormState.transactionCalls).toBe(1);
    expect(ormState.insertValues).toHaveLength(1);
    expect(ormState.insertValues[0]?.payload).toMatchObject({
      accessToken: 'KEYCHAIN_ONLY',
      userId: '77',
      email: 'new@example.com',
      plan: 'pro',
    });
    expect(secureStoreState.setCalls).toEqual([
      { key: 'taskforceai_auth_token', value: 'new-token' },
    ]);
  });

  it('SessionRepository preserves numeric user ID 0 when writing a session', async () => {
    const repo = new SessionRepository();
    const session = {
      accessToken: 'zero-id-token',
      expiresAt: Date.now() + 120_000,
      user: {
        id: 0,
        email: 'zero@example.com',
        plan: 'free',
      },
    } as any;

    const result = await repo.setSession(session);

    expect(result.ok).toBe(true);
    expect(ormState.insertValues[0]?.payload).toMatchObject({
      userId: '0',
      email: 'zero@example.com',
    });
  });

  it('SessionRepository persists expiry from JWT exp claim when available', async () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 3600;
    const jwtToken = makeJwtWithExp(expSeconds);
    const repo = new SessionRepository();
    const session = {
      accessToken: jwtToken,
      expiresAt: Date.now() + 5_000,
      user: {
        id: 55,
        email: 'jwt-exp@example.com',
        plan: 'pro',
      },
    } as any;

    const result = await repo.setSession(session);

    expect(result.ok).toBe(true);
    expect(ormState.insertValues[0]?.payload).toMatchObject({
      expiresAt: expSeconds * 1000,
      userId: '55',
      email: 'jwt-exp@example.com',
      plan: 'pro',
    });
  });

  it('UserRepository returns an error when stored profile JSON is malformed', async () => {
    ormState.selectPlans.push({
      rows: [
        createProfileRow({
          email: 'broken@example.com',
          fullName: 'Broken',
          data: '{bad json',
        }),
      ],
    });
    const repo = new UserRepository();

    const result = await repo.loadProfile();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('invalid');
    }
  });

  it('UserRepository returns ok(null) when no profile is stored', async () => {
    ormState.selectPlans.push({ rows: [] });
    const repo = new UserRepository();

    const result = await repo.loadProfile();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('UserRepository coerces legacy booleans and falls back invalid plans to free', async () => {
    ormState.selectPlans.push({
      rows: [
        createProfileRow({
          id: 202,
          plan: 'enterprise',
          messageCount: 7,
          data: createProfileData({
            disabled: false,
            is_admin: true,
          }),
        }),
      ],
    });
    const repo = new UserRepository();

    const result = await repo.loadProfile();

    expect(result.ok).toBe(true);
    if (result.ok && result.value) {
      expect(result.value.plan).toBe('free');
      expect(result.value.disabled).toBe('false');
      expect(result.value.is_admin).toBe('true');
    }
  });

  it('UserRepository loads the most recently updated profile when multiple rows exist', async () => {
    ormState.selectPlans.push({
      sortByUpdatedAtDesc: true,
      rows: [
        createProfileRow({
          id: 11,
          email: 'old@example.com',
          fullName: 'Old User',
          messageCount: 2,
          updatedAt: 100,
        }),
        createProfileRow({
          id: 22,
          email: 'new@example.com',
          fullName: 'New User',
          plan: 'pro',
          messageCount: 9,
          updatedAt: 200,
        }),
      ],
    });
    const repo = new UserRepository();

    const result = await repo.loadProfile();

    expect(ormState.selectRecords[0]?.orderByCalled).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok && result.value) {
      expect(result.value.email).toBe('new@example.com');
      expect(result.value.message_count).toBe(9);
      expect(result.value.plan).toBe('pro');
    }
  });

  it('UserRepository returns ok(null) when profile fails schema validation', async () => {
    ormState.selectPlans.push({
      rows: [
        createProfileRow({
          id: 303,
          email: 'invalid@example.com',
          fullName: 'Invalid',
          data: JSON.stringify({}),
        }),
      ],
    });
    const repo = new UserRepository();

    const result = await repo.loadProfile();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('UserRepository saveProfile stores known fields and serializes extra data', async () => {
    const repo = new UserRepository();
    const user = {
      id: 404,
      email: 'save@example.com',
      full_name: 'Saver',
      plan: 'pro',
      message_count: undefined,
      last_message_timestamp: null,
      subscription_status: null,
      current_period_end: null,
      avatar_url: 'https://cdn.example/avatar.png',
      custom_flag: true,
      subscription_id: null,
      subscription_source: null,
      current_period_start: null,
      cancel_at_period_end: false,
      theme_preference: 'system',
      memory_enabled: true,
      web_search_enabled: true,
      code_execution_enabled: true,
      notifications_enabled: true,
      trust_layer_enabled: true,
      quick_mode_enabled: false,
      customer_id: null,
      disabled: 'false',
      is_admin: 'false',
    } as any;

    const result = await repo.saveProfile(user);

    expect(result.ok).toBe(true);
    expect(ormState.insertValues).toHaveLength(1);
    const payload = ormState.insertValues[0]?.payload;
    expect(payload?.['email']).toBe('save@example.com');
    expect(payload?.['avatarUrl']).toBe('https://cdn.example/avatar.png');
    expect(payload?.['messageCount']).toBe(0);

    const extraData = payload?.['data'];
    const storedExtra = JSON.parse(
      typeof extraData === 'string' ? extraData : '{}'
    ) as Record<string, unknown>;
    expect(storedExtra['custom_flag']).toBe(true);
    expect(ormState.insertConflictSets).toHaveLength(1);
  });

  it('UserRepository clears stored profiles', async () => {
    const repo = new UserRepository();

    const result = await repo.clearProfile();

    expect(result.ok).toBe(true);
    expect(ormState.deleteTables).toHaveLength(1);
  });
});
