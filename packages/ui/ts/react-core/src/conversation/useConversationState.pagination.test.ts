import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import '../../../../../../tests/setup/dom';

import { configureLogger } from '../shared/logger';
import type { MessageRecord } from '../shared/types';
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

const globalWithMark = globalThis as typeof globalThis & {
  __TASKFORCEAI_LATENCY_MARK__?: unknown;
};

describe('useConversationState pagination and hydration', () => {
  afterEach(() => {
    delete globalWithMark.__TASKFORCEAI_LATENCY_MARK__;
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

    const { result } = renderUseConversationState({ conversationStore, storage });

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

    const { result } = renderUseConversationState({ conversationStore, storage });

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

    const { result } = renderUseConversationState({ conversationStore, storage });

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

  it('ignores a stale loadConversation response after starting a new chat', async () => {
    const storage = createStorage();
    const staleLoad = createDeferred<MessageRecord[]>();
    const conversationStore = createConversationStore({
      getConversationMessages: vi.fn(() => staleLoad.promise),
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    let loadPromise!: Promise<void>;
    act(() => {
      loadPromise = result.current.loadConversation({ id: 1 } as ConversationSummary);
    });
    await waitFor(() => expect(conversationStore.getConversationMessages).toHaveBeenCalled());

    await act(async () => {
      await result.current.handleNewChat();
    });
    const newConversationId = result.current.conversationId;

    await act(async () => {
      staleLoad.resolve([
        createMessageRecord('m-stale', 'remote-1', 'assistant', 'stale conversation'),
      ]);
      await loadPromise;
    });

    expect(newConversationId).toMatch(/^local-/);
    expect(result.current.conversationId).toBe(newConversationId);
    expect(result.current.messages).toEqual([]);
    expect((storage.setItem as ReturnType<typeof vi.fn>).mock.calls).not.toContainEqual([
      ACTIVE_CONVERSATION_KEY,
      'remote-1',
    ]);
  });

  it('ignores stale loadConversation errors after a newer conversation finishes', async () => {
    const storage = createStorage();
    const remoteOneDeferred = createDeferred<MessageRecord[]>();
    const conversationStore = createConversationStore({
      getConversationMessages: vi.fn().mockImplementation(async (conversationId: string) => {
        if (conversationId === 'remote-1') {
          return remoteOneDeferred.promise;
        }
        return [createMessageRecord('m-remote-2', 'remote-2', 'assistant', 'newer')];
      }),
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    let firstLoad!: Promise<void>;
    await act(async () => {
      firstLoad = result.current.loadConversation({ id: 1 } as ConversationSummary);
      await result.current.loadConversation({ id: 2 } as ConversationSummary);
    });

    await waitFor(() => expect(result.current.conversationId).toBe('remote-2'));

    await act(async () => {
      remoteOneDeferred.resolve(
        Promise.reject(new Error('stale load failed')) as unknown as MessageRecord[]
      );
      await firstLoad;
    });

    expect(result.current.conversationId).toBe('remote-2');
    expect(result.current.messages[0]?.id).toBe('m-remote-2');
  });

  it('marks pagination exhausted when a loaded page is empty', async () => {
    const storage = createStorage();
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      createMessageRecord(`m-${index}`, 'remote-90', 'assistant', `p${index}`)
    );
    const conversationStore = createConversationStore({
      getConversationMessages: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce([]),
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.loadConversation({ id: 90 } as ConversationSummary);
    });

    await waitFor(() => expect(result.current.hasMoreMessages).toBe(true));

    await act(async () => {
      await result.current.loadMoreMessages();
    });

    expect(result.current.messages).toHaveLength(50);
    await waitFor(() => expect(result.current.hasMoreMessages).toBe(false));
  });

  it('ignores a pagination response after the active conversation changes', async () => {
    const storage = createStorage();
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      createMessageRecord(`m-${index}`, 'remote-91', 'assistant', `p${index}`)
    );
    const nextPageDeferred = createDeferred<MessageRecord[]>();
    const conversationStore = createConversationStore({
      getConversationMessages: vi
        .fn()
        .mockResolvedValueOnce(firstPage)
        .mockImplementationOnce(() => nextPageDeferred.promise),
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.loadConversation({ id: 91 } as ConversationSummary);
    });

    let loadMore!: Promise<void>;
    await act(async () => {
      loadMore = result.current.loadMoreMessages();
      await result.current.handleNewChat();
    });

    await act(async () => {
      nextPageDeferred.resolve([createMessageRecord('m-stale', 'remote-91', 'assistant', 'stale')]);
      await loadMore;
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.conversationId).toMatch(/^local-/);
  });

  it('keeps the current pagination lock when a stale request settles', async () => {
    const storage = createStorage();
    const stalePageDeferred = createDeferred<MessageRecord[]>();
    const currentPageDeferred = createDeferred<MessageRecord[]>();
    const firstPage = (conversationId: string) =>
      Array.from({ length: 50 }, (_, index) =>
        createMessageRecord(
          `m-${conversationId}-${index}`,
          conversationId,
          'assistant',
          `p${index}`
        )
      );
    const getConversationMessages = vi.fn((conversationId: string, _limit?: number, offset = 0) => {
      if (offset === 0) {
        return Promise.resolve(firstPage(conversationId));
      }
      if (conversationId === 'remote-91') {
        return stalePageDeferred.promise;
      }
      if (conversationId === 'remote-92') {
        return currentPageDeferred.promise;
      }
      return Promise.resolve([]);
    });
    const conversationStore = createConversationStore({ getConversationMessages });
    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await act(async () => {
      await result.current.loadConversation({ id: 91 } as ConversationSummary);
    });

    let staleLoad!: Promise<void>;
    act(() => {
      staleLoad = result.current.loadMoreMessages();
    });
    await waitFor(() => expect(result.current.isLoadingMore).toBe(true));

    await act(async () => {
      await result.current.loadConversation({ id: 92 } as ConversationSummary);
    });

    let currentLoad!: Promise<void>;
    act(() => {
      currentLoad = result.current.loadMoreMessages();
    });
    await waitFor(() => expect(result.current.isLoadingMore).toBe(true));

    await act(async () => {
      stalePageDeferred.resolve([
        createMessageRecord('m-stale', 'remote-91', 'assistant', 'stale page'),
      ]);
      await staleLoad;
    });

    expect(result.current.isLoadingMore).toBe(true);
    await act(async () => {
      await result.current.loadMoreMessages();
    });
    expect(
      getConversationMessages.mock.calls.filter(
        ([conversationId, _limit, offset]) => conversationId === 'remote-92' && offset === 50
      )
    ).toHaveLength(1);

    await act(async () => {
      currentPageDeferred.resolve([
        createMessageRecord('m-current', 'remote-92', 'assistant', 'current page'),
      ]);
      await currentLoad;
    });

    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.messages).toHaveLength(51);
    expect(result.current.messages[50]?.id).toBe('m-current');
  });

  it('recovers loading state when pagination throws', async () => {
    const storage = createStorage();
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      createMessageRecord(`m-${index}`, 'remote-92', 'assistant', `p${index}`)
    );
    const conversationStore = createConversationStore({
      getConversationMessages: vi
        .fn()
        .mockResolvedValueOnce(firstPage)
        .mockRejectedValueOnce(new Error('pagination failed')),
    });

    const { result } = renderUseConversationState({ conversationStore, storage });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.loadConversation({ id: 92 } as ConversationSummary);
    });

    await waitFor(() => expect(result.current.hasMoreMessages).toBe(true));

    await act(async () => {
      await result.current.loadMoreMessages();
    });

    expect(result.current.messages).toHaveLength(50);
    expect(result.current.isLoadingMore).toBe(false);
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

    const { result } = renderUseConversationState({ conversationStore, storage });

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
    const conversationStore = createRestorableConversationStore();

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
    expect(result.current.messages[0]?.content).toBe('local-2');

    await act(async () => {
      firstRestore.resolve('local-1');
      await firstRestore.promise;
    });

    expect(result.current.conversationId).toBe('local-2');
    expect(result.current.messages[0]?.content).toBe('local-2');
  });

  it('logs persistence failures after adding a user message', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    configureLogger(logger);
    const persistenceError = new Error('write failed');
    const conversationStore = createConversationStore({
      upsertMessage: vi.fn().mockRejectedValue(persistenceError),
    });
    const storage = createStorage();

    const { result } = renderUseConversationState({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.addUserMessage('persist me');
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        '[useConversationState] Failed to persist user message',
        { error: persistenceError }
      )
    );
  });
});
