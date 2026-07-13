import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { localSearch } from '@taskforceai/client-runtime/local-search';
import { err } from '@taskforceai/client-core/result';
import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import '../../../../../tests/setup/dom';

import { configureLogger } from './logger';
import { configureLatencyReporter } from './latency';
import type { MessageRecord } from './types';
import type { UseConversationStateProps } from './useConversationState';
import {
  ACTIVE_CONVERSATION_KEY,
  createConversationStore,
  createDeferred,
  createMessageRecord,
  createRestorableConversationStore,
  createStorage,
  renderUseConversationState,
} from './useConversationState.test-harness';

describe('useConversationState', () => {
  afterEach(() => {
    configureLatencyReporter(() => {});
    configureLogger({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores a saved conversation and hydrates mapped messages', async () => {
    const conversationId = 'local-restored';
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue(conversationId),
    });
    const conversationStore = createRestorableConversationStore({
      title: 'Restored',
      messages: [
        {
          messageId: 'm-1',
          conversationId,
          role: 'assistant',
          content: 'hello',
          isStreaming: true,
          isAgentStatus: true,
          elapsedSeconds: 8,
          createdAt: 10,
          updatedAt: 11,
          trace_id: 'trace-1',
        },
        {
          messageId: 'm-2',
          conversationId,
          role: 'user',
          content: 'hi',
          isStreaming: false,
          createdAt: 12,
          updatedAt: 13,
          sources: [{ title: 'Doc', url: 'https://example.com' } as any],
          toolEvents: [{ type: 'tool_start' } as any],
          agentStatuses: [{ status: 'COMPLETE' } as any],
        },
      ],
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    expect(result.current.conversationId).toBe(conversationId);
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toEqual({
      id: 'm-1',
      content: 'hello',
      role: 'assistant',
      sources: [],
      toolEvents: [],
      agentStatuses: [],
      trace_id: 'trace-1',
      isStreaming: true,
      isAgentStatus: true,
      elapsedSeconds: 8,
      createdAt: 10,
      updatedAt: 11,
    });
    expect(result.current.messages[1]?.sources).toHaveLength(1);
    expect(result.current.messages[1]?.toolEvents).toHaveLength(1);
    expect(result.current.messages[1]?.agentStatuses).toHaveLength(1);
    expect(result.current.hasMoreMessages).toBe(false);
    expect(storage.getItem).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY);
    expect(conversationStore.getConversationMessages).toHaveBeenCalledWith(conversationId, 50, 0);

    await expect(result.current.ensureActiveConversation()).resolves.toBe(conversationId);
    expect(conversationStore.ensureConversation).not.toHaveBeenCalled();
  });

  it('waits for session loading before starting initialization when auth is unknown', async () => {
    const storage = createStorage();
    const conversationStore = createConversationStore();

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      sessionStatus: 'loading',
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isInitialized).toBe(false);
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it('restores a saved conversation without a configured latency side effect', async () => {
    const conversationId = 'local-restored';
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue(conversationId),
    });
    const conversationStore = createRestorableConversationStore({
      title: 'Restored',
      messages: [createMessageRecord('m-1', conversationId, 'assistant', 'hello')],
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    expect(result.current.conversationId).toBe(conversationId);
    expect(result.current.messages).toHaveLength(1);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('isolates throwing latency markers from conversation initialization', async () => {
    const mark = vi.fn(() => {
      throw new Error('latency marker failed');
    });
    configureLatencyReporter(mark);
    const conversationId = 'local-restored';
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue(conversationId),
    });
    const conversationStore = createRestorableConversationStore({
      title: 'Restored',
      messages: [createMessageRecord('m-1', conversationId, 'assistant', 'hello')],
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    expect(mark).toHaveBeenCalled();
    expect(result.current.conversationId).toBe(conversationId);
    expect(result.current.messages).toHaveLength(1);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('restores a bounded message page and can load the next page', async () => {
    const conversationId = 'local-restored';
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      createMessageRecord(
        `m-${index}`,
        conversationId,
        index % 2 === 0 ? 'assistant' : 'user',
        `message ${index}`
      )
    );
    const secondPage = [createMessageRecord('m-50', conversationId, 'assistant', 'message 50')];
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue(conversationId),
    });
    const conversationStore = createRestorableConversationStore({
      title: 'Restored',
      getConversationMessages: vi
        .fn()
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage),
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    expect(result.current.messages).toHaveLength(50);
    expect(result.current.hasMoreMessages).toBe(true);
    expect(conversationStore.getConversationMessages).toHaveBeenNthCalledWith(
      1,
      conversationId,
      50,
      0
    );

    await act(async () => {
      await result.current.loadMoreMessages();
    });

    expect(result.current.messages).toHaveLength(51);
    expect(result.current.messages[50]?.id).toBe('m-50');
    expect(result.current.hasMoreMessages).toBe(false);
    expect(conversationStore.getConversationMessages).toHaveBeenNthCalledWith(
      2,
      conversationId,
      50,
      50
    );
  });

  it('waits for an in-flight restore before creating an active conversation', async () => {
    const conversationId = 'local-restoring';
    const restoredMessages = createDeferred<MessageRecord[]>();
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue(conversationId),
    });
    const conversationStore = createRestorableConversationStore({
      title: 'Restoring',
      getConversationMessages: vi.fn().mockReturnValue(restoredMessages.promise),
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(conversationStore.getConversationMessages).toHaveBeenCalled());

    const ensurePromise = result.current.ensureActiveConversation();
    await Promise.resolve();

    expect(conversationStore.ensureConversation).not.toHaveBeenCalled();

    let ensuredConversationId: string | undefined;
    await act(async () => {
      restoredMessages.resolve([
        createMessageRecord('m-restored', conversationId, 'assistant', 'done'),
      ]);
      ensuredConversationId = await ensurePromise;
    });

    expect(ensuredConversationId).toBe(conversationId);
    expect(conversationStore.ensureConversation).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.conversationId).toBe(conversationId);
  });

  it('removes stale saved conversation ids that cannot be restored', async () => {
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue('local-stale'),
    });
    const conversationStore = createConversationStore({
      getConversation: vi
        .fn()
        .mockResolvedValue(err({ kind: 'not_found' as const, message: 'Not found' })),
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(conversationStore.getConversationMessages).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY);
  });

  it('clears active conversation storage when restore throws', async () => {
    const storageError = new Error('storage offline');
    const storage = createStorage({
      getItem: vi.fn().mockRejectedValue(storageError),
    });
    const conversationStore = createConversationStore();

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    expect(result.current.conversationId).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY);
  });

  it('ignores stale restore errors after the active key changes', async () => {
    const firstRestore = createDeferred<string | null>();
    const secondRestore = createDeferred<string | null>();
    const storage = createStorage({
      getItem: vi.fn().mockImplementation(async (key: string) => {
        if (key === 'active-1') {
          return firstRestore.promise;
        }
        if (key === 'active-2') {
          return secondRestore.promise;
        }
        return null;
      }),
    });
    const conversationStore = createRestorableConversationStore();

    const { result, rerender } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: 'active-1',
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

    await act(async () => {
      rerender({
        conversationStore,
        storage,
        activeConversationKey: 'active-2',
        isAuthenticated: true,
        sessionStatus: 'authenticated',
      });
    });

    await act(async () => {
      secondRestore.resolve('local-2');
      await secondRestore.promise;
    });

    await waitFor(() => expect(result.current.conversationId).toBe('local-2'));

    await act(async () => {
      firstRestore.resolve(Promise.reject(new Error('stale restore failed')) as unknown as string);
      await firstRestore.promise.catch(() => undefined);
    });

    expect(result.current.conversationId).toBe('local-2');
    expect(storage.removeItem).not.toHaveBeenCalledWith('active-1');
  });

  it('restores a saved conversation after authentication transitions to true', async () => {
    const conversationId = 'local-auth-transition';
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue(conversationId),
    });
    const conversationStore = createRestorableConversationStore({
      title: 'Restored After Login',
      messages: [createMessageRecord('m-auth', conversationId, 'assistant', 'welcome back')],
    });

    const initialProps: UseConversationStateProps = {
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: false,
      sessionStatus: 'unauthenticated',
      user: null,
    };

    const { result, rerender } = renderUseConversationState(initialProps);

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.conversationId).toBeNull();

    rerender({
      ...initialProps,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

    await waitFor(() => expect(result.current.conversationId).toBe(conversationId));
    expect(result.current.messages).toHaveLength(1);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it('persists a new user message and indexes it for local search', async () => {
    const storage = createStorage();
    const conversationStore = createConversationStore();
    const addItemSpy = vi.spyOn(localSearch, 'addItem').mockImplementation(() => {});

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.addUserMessage('  Hello world  ');
    });

    const conversationId = result.current.conversationId;
    expect(conversationId).not.toBeNull();
    expect(conversationId).toMatch(/^local-/);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.role).toBe('user');
    expect(result.current.messages[0]?.content).toBe('  Hello world  ');

    expect(conversationStore.ensureConversation).toHaveBeenNthCalledWith(
      1,
      conversationId,
      'New Conversation'
    );
    expect(conversationStore.ensureConversation).toHaveBeenNthCalledWith(
      2,
      conversationId,
      'Hello world'
    );

    expect(storage.setItem).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY, conversationId);
    await waitFor(() => expect(conversationStore.upsertMessage).toHaveBeenCalledTimes(1));

    const upsertCall = (conversationStore.upsertMessage as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(upsertCall.conversationId).toBe(conversationId);
    expect(upsertCall.role).toBe('user');
    expect(upsertCall.content).toBe('  Hello world  ');
    expect(upsertCall.messageId).toMatch(/^user-/);
    expect(result.current.messages[0]?.id).toBe(upsertCall.messageId);

    expect(addItemSpy).toHaveBeenCalledWith({
      id: upsertCall.messageId,
      title: 'Hello world',
      content: '  Hello world  ',
      tags: [conversationId, 'user'],
    });
  });

  it('sequences conversation creation before persisting a user message', async () => {
    const storage = createStorage();
    const order: string[] = [];
    const conversationStore = createConversationStore({
      ensureConversation: vi.fn().mockImplementation(async () => {
        order.push('ensure:start');
        await Promise.resolve();
        order.push('ensure:end');
      }),
      upsertMessage: vi.fn().mockImplementation(async () => {
        order.push('upsert');
      }),
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.addUserMessage('Hello world');
    });

    await waitFor(() => expect(conversationStore.upsertMessage).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['ensure:start', 'ensure:end', 'ensure:start', 'ensure:end', 'upsert']);
  });

  it('keeps private chat messages in memory only', async () => {
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue('local-restored'),
    });
    const conversationStore = createConversationStore();
    const addItemSpy = vi.spyOn(localSearch, 'addItem').mockImplementation(() => {});

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isPrivateMode: true,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    expect(storage.getItem).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.addUserMessage('keep this local');
    });

    const conversationId = result.current.conversationId;
    expect(conversationId).toMatch(/^private-/);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.content).toBe('keep this local');
    expect(conversationStore.ensureConversation).not.toHaveBeenCalled();
    expect(conversationStore.upsertMessage).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(addItemSpy).not.toHaveBeenCalled();

    act(() => {
      result.current.updateToRemoteConversation(77);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.conversationId).toBe(conversationId);
    expect(conversationStore.replaceConversationId).not.toHaveBeenCalled();
  });

  it('does not persist the active conversation when loading while in private mode', async () => {
    const storage = createStorage();
    const conversationStore = createConversationStore({
      getConversationMessages: vi
        .fn()
        .mockResolvedValue([
          createMessageRecord('m-private-load', 'remote-42', 'assistant', 'saved'),
        ]),
    });

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isPrivateMode: true,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.loadConversation({ id: 42 } as ConversationSummary);
    });

    expect(result.current.conversationId).toBe('remote-42');
    expect(result.current.messages).toHaveLength(1);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('marks initialization complete when switching into private mode before restore starts', async () => {
    const storage = createStorage();
    const conversationStore = createConversationStore();
    const initialProps: UseConversationStateProps = {
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      sessionStatus: 'loading',
    };

    const { result, rerender } = renderUseConversationState(initialProps);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isInitialized).toBe(false);
    expect(storage.getItem).not.toHaveBeenCalled();

    rerender({
      ...initialProps,
      isPrivateMode: true,
    });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.messages).toEqual([]);
    expect(result.current.conversationId).toBeNull();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(conversationStore.getConversation).not.toHaveBeenCalled();
  });

  it('clears private chat state without persisting when starting a new private chat', async () => {
    const storage = createStorage();
    const conversationStore = createConversationStore();

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isPrivateMode: true,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.addUserMessage('private draft');
    });

    expect(result.current.conversationId).toMatch(/^private-/);
    expect(result.current.messages).toHaveLength(1);

    await act(async () => {
      await result.current.handleNewChat();
    });

    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(result.current.isInitialized).toBe(true);
    expect(result.current.hasMoreMessages).toBe(false);
    expect(result.current.isLoadingMore).toBe(false);
    expect(conversationStore.ensureConversation).not.toHaveBeenCalled();
    expect(conversationStore.upsertMessage).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('migrates a local conversation before switching to the remote id', async () => {
    const storage = createStorage();
    const conversationStore = createConversationStore();

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.addUserMessage('Hello remote');
    });

    const localConversationId = result.current.conversationId;
    expect(localConversationId).toMatch(/^local-/);

    act(() => {
      result.current.updateToRemoteConversation(123);
    });

    await waitFor(() => expect(result.current.conversationId).toBe('remote-123'));
    expect(conversationStore.replaceConversationId).toHaveBeenCalledWith(
      localConversationId,
      'remote-123'
    );
    expect(storage.setItem).toHaveBeenLastCalledWith(ACTIVE_CONVERSATION_KEY, 'remote-123');
  });

  it('keeps the local conversation active if remote id migration fails', async () => {
    const storage = createStorage();
    const conversationStore = createConversationStore({
      replaceConversationId: vi.fn().mockRejectedValue(new Error('replace failed')),
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.addUserMessage('Hello local');
    });

    const localConversationId = result.current.conversationId;
    act(() => {
      result.current.updateToRemoteConversation(456);
    });

    await waitFor(() =>
      expect(conversationStore.replaceConversationId).toHaveBeenCalledWith(
        localConversationId,
        'remote-456'
      )
    );
    expect(result.current.conversationId).toBe(localConversationId);
    expect(storage.setItem).not.toHaveBeenLastCalledWith(ACTIVE_CONVERSATION_KEY, 'remote-456');
  });

  it('ignores a stale remote id migration after the active conversation changes', async () => {
    const storage = createStorage();
    const migration = createDeferred<void>();
    const conversationStore = createConversationStore({
      replaceConversationId: vi.fn().mockReturnValue(migration.promise),
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.addUserMessage('Hello remote');
    });

    const localConversationId = result.current.conversationId;
    act(() => {
      result.current.updateToRemoteConversation(789);
    });
    await waitFor(() =>
      expect(conversationStore.replaceConversationId).toHaveBeenCalledWith(
        localConversationId,
        'remote-789'
      )
    );

    await act(async () => {
      await result.current.handleNewChat();
    });
    const nextConversationId = result.current.conversationId;

    await act(async () => {
      migration.resolve();
      await migration.promise;
    });

    expect(result.current.conversationId).toBe(nextConversationId);
    expect(result.current.conversationId).not.toBe('remote-789');
    expect(storage.setItem).not.toHaveBeenLastCalledWith(ACTIVE_CONVERSATION_KEY, 'remote-789');
  });
});
