import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { localSearch } from '@taskforceai/shared';
import { ok, err } from '@taskforceai/shared/result';
import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import '../../../tests/setup/dom';

import { useConversationState, type UseConversationStateProps } from './useConversationState';
import type { ConversationStore, KeyValueStorage, MessageRecord } from './types';

const ACTIVE_CONVERSATION_KEY = 'active-conversation';

const createConversationStore = (
  overrides: Partial<ConversationStore> = {}
): ConversationStore => ({
  ensureConversation: vi.fn().mockResolvedValue(undefined),
  renameConversation: vi.fn().mockResolvedValue(undefined),
  getConversation: vi
    .fn()
    .mockResolvedValue(err({ kind: 'not_found' as const, message: 'Missing conversation' })),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  upsertMessage: vi.fn().mockResolvedValue(undefined),
  listConversations: vi.fn().mockResolvedValue([]),
  clearConversation: vi.fn().mockResolvedValue(undefined),
  replaceConversationId: vi.fn().mockResolvedValue(undefined),
  enqueuePrompt: vi.fn().mockResolvedValue(undefined),
  updatePromptStatus: vi.fn().mockResolvedValue(undefined),
  removePrompt: vi.fn().mockResolvedValue(undefined),
  listPendingPrompts: vi.fn().mockResolvedValue([]),
  subscribe: vi.fn().mockReturnValue(() => {}),
  ...overrides,
});

const createStorage = (overrides: Partial<KeyValueStorage> = {}): KeyValueStorage => ({
  getItem: vi.fn().mockResolvedValue(null),
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const createMessageRecord = (
  messageId: string,
  conversationId: string,
  role: MessageRecord['role'],
  content: string
): MessageRecord => ({
  messageId,
  conversationId,
  role,
  content,
  isStreaming: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

const renderUseConversationState = (props: UseConversationStateProps) =>
  renderHook((input: UseConversationStateProps) => useConversationState(input), {
    initialProps: props,
  });

describe('useConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores a saved conversation and hydrates mapped messages', async () => {
    const conversationId = 'local-restored';
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue(conversationId),
    });
    const conversationStore = createConversationStore({
      getConversation: vi.fn().mockResolvedValue(
        ok({
          conversationId,
          title: 'Restored',
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: null,
        })
      ),
      getConversationMessages: vi.fn().mockResolvedValue([
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
      ]),
    });

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

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
    expect(storage.getItem).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY);
    expect(conversationStore.getConversationMessages).toHaveBeenCalledWith(conversationId);
  });

  it('waits for an in-flight restore before creating an active conversation', async () => {
    const conversationId = 'local-restoring';
    const restoredMessages = createDeferred<MessageRecord[]>();
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue(conversationId),
    });
    const conversationStore = createConversationStore({
      getConversation: vi.fn().mockResolvedValue(
        ok({
          conversationId,
          title: 'Restoring',
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: null,
        })
      ),
      getConversationMessages: vi.fn().mockReturnValue(restoredMessages.promise),
    });

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

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

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(conversationStore.getConversationMessages).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY);
  });

  it('restores a saved conversation after authentication transitions to true', async () => {
    const conversationId = 'local-auth-transition';
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue(conversationId),
    });
    const conversationStore = createConversationStore({
      getConversation: vi.fn().mockResolvedValue(
        ok({
          conversationId,
          title: 'Restored After Login',
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: null,
        })
      ),
      getConversationMessages: vi
        .fn()
        .mockResolvedValue([
          createMessageRecord('m-auth', conversationId, 'assistant', 'welcome back'),
        ]),
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

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

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
    expect(conversationStore.upsertMessage).toHaveBeenCalledTimes(1);

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

  it('migrates a local conversation before switching to the remote id', async () => {
    const storage = createStorage();
    const conversationStore = createConversationStore();

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

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

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

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

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

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

  it('maps loaded pages and toggles pagination loading transitions', async () => {
    const storage = createStorage();
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      createMessageRecord(
        `m-${index}`,
        'remote-77',
        index % 2 === 0 ? 'assistant' : 'user',
        `p${index}`
      )
    );
    const firstMessage = firstPage[0];
    if (!firstMessage) {
      throw new Error('Expected first page to contain at least one message');
    }
    firstPage[0] = {
      ...firstMessage,
      sources: undefined,
      toolEvents: undefined,
      agentStatuses: undefined,
      trace_id: 'trace-page-1',
      isStreaming: true,
      isAgentStatus: true,
      elapsedSeconds: 12,
    };
    const secondPage = [
      createMessageRecord('m-50', 'remote-77', 'assistant', 'p50'),
      createMessageRecord('m-51', 'remote-77', 'user', 'p51'),
    ];
    const nextPageDeferred = createDeferred<MessageRecord[]>();

    const conversationStore = createConversationStore({
      getConversationMessages: vi
        .fn()
        .mockResolvedValueOnce(firstPage)
        .mockImplementationOnce(() => nextPageDeferred.promise),
    });

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    const conversation = {
      id: 77,
      model: 'local-ignored',
      isPublic: true,
      shareId: 'share-77',
    } as ConversationSummary;

    await act(async () => {
      await result.current.loadConversation(conversation);
    });

    expect(result.current.conversationId).toBe('remote-77');
    expect(result.current.messages).toHaveLength(50);
    expect(result.current.messages[0]).toEqual({
      id: 'm-0',
      content: 'p0',
      role: 'assistant',
      sources: [],
      toolEvents: [],
      agentStatuses: [],
      trace_id: 'trace-page-1',
      isStreaming: true,
      isAgentStatus: true,
      elapsedSeconds: 12,
      createdAt: firstPage[0]?.createdAt,
      updatedAt: firstPage[0]?.updatedAt,
    });
    expect(result.current.hasMoreMessages).toBe(true);
    expect(result.current.isPublic).toBe(true);
    expect(result.current.shareId).toBe('share-77');
    expect(conversationStore.getConversationMessages).toHaveBeenNthCalledWith(
      1,
      'remote-77',
      50,
      0
    );

    act(() => {
      void result.current.loadMoreMessages();
    });

    expect(result.current.isLoadingMore).toBe(true);

    await act(async () => {
      nextPageDeferred.resolve(secondPage);
      await nextPageDeferred.promise;
    });

    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));

    expect(result.current.messages).toHaveLength(52);
    expect(result.current.messages[50]?.id).toBe('m-50');
    expect(result.current.messages[51]?.id).toBe('m-51');
    expect(result.current.hasMoreMessages).toBe(false);
    expect(conversationStore.getConversationMessages).toHaveBeenNthCalledWith(
      2,
      'remote-77',
      50,
      50
    );

    await act(async () => {
      await result.current.loadMoreMessages();
    });
    expect(conversationStore.getConversationMessages).toHaveBeenCalledTimes(2);
  });

  it('ignores overlapping loadMoreMessages calls and appends one page once', async () => {
    const storage = createStorage();
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      createMessageRecord(
        `m-${index}`,
        'remote-88',
        index % 2 === 0 ? 'assistant' : 'user',
        `p${index}`
      )
    );
    const secondPage = [
      createMessageRecord('m-50', 'remote-88', 'assistant', 'p50'),
      createMessageRecord('m-51', 'remote-88', 'user', 'p51'),
    ];
    const nextPageDeferred = createDeferred<MessageRecord[]>();

    const conversationStore = createConversationStore({
      getConversationMessages: vi
        .fn()
        .mockResolvedValueOnce(firstPage)
        .mockImplementation(() => nextPageDeferred.promise),
    });

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.loadConversation({ id: 88 } as ConversationSummary);
    });

    await act(async () => {
      const firstLoad = result.current.loadMoreMessages();
      const secondLoad = result.current.loadMoreMessages();
      nextPageDeferred.resolve(secondPage);
      await Promise.all([firstLoad, secondLoad]);
    });

    expect(result.current.messages).toHaveLength(52);
    expect(result.current.messages[50]?.id).toBe('m-50');
    expect(result.current.messages[51]?.id).toBe('m-51');
    expect(conversationStore.getConversationMessages).toHaveBeenCalledTimes(2);
  });

  it('ignores stale loadConversation responses when a newer conversation finishes first', async () => {
    const storage = createStorage();
    const remoteOneDeferred = createDeferred<MessageRecord[]>();
    const remoteTwoDeferred = createDeferred<MessageRecord[]>();
    const conversationStore = createConversationStore({
      getConversationMessages: vi.fn().mockImplementation(async (conversationId: string) => {
        if (conversationId === 'remote-1') {
          return remoteOneDeferred.promise;
        }
        if (conversationId === 'remote-2') {
          return remoteTwoDeferred.promise;
        }
        return [];
      }),
    });

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    let firstLoad!: Promise<void>;
    let secondLoad!: Promise<void>;
    await act(async () => {
      firstLoad = result.current.loadConversation({ id: 1 } as ConversationSummary);
      secondLoad = result.current.loadConversation({ id: 2 } as ConversationSummary);
    });

    await act(async () => {
      remoteTwoDeferred.resolve([
        createMessageRecord('m-remote-2', 'remote-2', 'assistant', 'newer'),
      ]);
      await secondLoad;
    });

    await waitFor(() => expect(result.current.conversationId).toBe('remote-2'));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.id).toBe('m-remote-2');

    await act(async () => {
      remoteOneDeferred.resolve([
        createMessageRecord('m-remote-1', 'remote-1', 'assistant', 'older'),
      ]);
      await firstLoad;
    });

    expect(result.current.conversationId).toBe('remote-2');
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.id).toBe('m-remote-2');

    const setItemCalls = (storage.setItem as ReturnType<typeof vi.fn>).mock.calls;
    expect(setItemCalls).toContainEqual([ACTIVE_CONVERSATION_KEY, 'remote-2']);
    expect(setItemCalls).not.toContainEqual([ACTIVE_CONVERSATION_KEY, 'remote-1']);
  });

  it('resets share state when loading a conversation without sharing metadata', async () => {
    const storage = createStorage();
    const conversationStore = createConversationStore({
      getConversationMessages: vi
        .fn()
        .mockImplementation(async (conversationId: string) => [
          createMessageRecord(`m-${conversationId}`, conversationId, 'assistant', conversationId),
        ]),
    });

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.loadConversation({
        id: 101,
        isPublic: true,
        shareId: 'share-101',
      } as ConversationSummary);
    });

    expect(result.current.isPublic).toBe(true);
    expect(result.current.shareId).toBe('share-101');

    await act(async () => {
      await result.current.loadConversation({ id: 202 } as ConversationSummary);
    });

    expect(result.current.isPublic).toBe(false);
    expect(result.current.shareId).toBeNull();
  });

  it('resets state and clears persisted active conversation when unauthenticated', async () => {
    const storage = createStorage();
    const conversationStore = createConversationStore({
      getConversationMessages: vi
        .fn()
        .mockResolvedValue([createMessageRecord('m-1', 'remote-11', 'assistant', 'hello')]),
    });

    const initialProps: UseConversationStateProps = {
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    };

    const { result, rerender } = renderUseConversationState(initialProps);

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.loadConversation({
        id: 11,
        isPublic: true,
        shareId: 'share-11',
      } as ConversationSummary);
    });

    expect(result.current.conversationId).toBe('remote-11');
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.isPublic).toBe(true);
    expect(result.current.shareId).toBe('share-11');

    rerender({
      ...initialProps,
      isAuthenticated: false,
      sessionStatus: 'unauthenticated',
    });

    await waitFor(() => {
      expect(result.current.conversationId).toBeNull();
      expect(result.current.messages).toEqual([]);
      expect(result.current.isPublic).toBe(false);
      expect(result.current.shareId).toBeNull();
    });
    expect(storage.removeItem).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY);
  });

  it('marks initialization complete when unauthenticated with a cached user', async () => {
    const storage = createStorage();
    const conversationStore = createConversationStore();

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: false,
      sessionStatus: 'unauthenticated',
      user: { id: 'cached-user' },
    });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.conversationId).toBeNull();
    expect(conversationStore.getConversation).not.toHaveBeenCalled();
  });

  it('rehydrates from the new key when activeConversationKey changes', async () => {
    const storage = createStorage({
      getItem: vi
        .fn()
        .mockImplementation(async (key: string) => (key === 'active-1' ? 'local-1' : 'local-2')),
    });
    const conversationStore = createConversationStore({
      getConversation: vi.fn().mockImplementation(async (conversationId: string) =>
        ok({
          conversationId,
          title: conversationId,
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: null,
        })
      ),
      getConversationMessages: vi
        .fn()
        .mockImplementation(async (conversationId: string) => [
          createMessageRecord(`m-${conversationId}`, conversationId, 'assistant', conversationId),
        ]),
    });

    const { result, rerender } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: 'active-1',
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

    await waitFor(() => expect(result.current.conversationId).toBe('local-1'));
    expect(result.current.messages[0]?.content).toBe('local-1');

    await act(async () => {
      rerender({
        conversationStore,
        storage,
        activeConversationKey: 'active-2',
        isAuthenticated: true,
        sessionStatus: 'authenticated',
      });
    });

    await waitFor(() => expect(result.current.conversationId).toBe('local-2'));
    expect(result.current.messages[0]?.content).toBe('local-2');
    expect(storage.getItem).toHaveBeenCalledWith('active-1');
    expect(storage.getItem).toHaveBeenCalledWith('active-2');

    const setItemCalls = (storage.setItem as ReturnType<typeof vi.fn>).mock.calls;
    expect(setItemCalls).toContainEqual(['active-2', 'local-2']);
    expect(setItemCalls).not.toContainEqual(['active-2', 'local-1']);
  });

  it('ignores stale restore results when activeConversationKey switches during hydration', async () => {
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
    const conversationStore = createConversationStore({
      getConversation: vi.fn().mockImplementation(async (conversationId: string) =>
        ok({
          conversationId,
          title: conversationId,
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: null,
        })
      ),
      getConversationMessages: vi
        .fn()
        .mockImplementation(async (conversationId: string) => [
          createMessageRecord(`m-${conversationId}`, conversationId, 'assistant', conversationId),
        ]),
    });

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
    expect(result.current.messages[0]?.content).toBe('local-2');

    await act(async () => {
      firstRestore.resolve('local-1');
      await firstRestore.promise;
    });

    expect(result.current.conversationId).toBe('local-2');
    expect(result.current.messages[0]?.content).toBe('local-2');
  });
});
