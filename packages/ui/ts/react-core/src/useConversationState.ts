import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import { localSearch } from '@taskforceai/client-runtime/local-search';
import {
  loadConversationSnapshot,
  loadMoreConversationMessages,
  restoreConversationSnapshot,
} from '@taskforceai/client-runtime';
import type { Message } from '@taskforceai/client-core/chat/types';
import { createId } from '@taskforceai/client-runtime/id';
import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from './logger';
import { reportLatencyMark } from './latency';
import type { ConversationStore, KeyValueStorage } from './types';

const markLatency = reportLatencyMark;

export interface UseConversationStateProps {
  conversationStore: ConversationStore;
  storage: KeyValueStorage;
  activeConversationKey: string;
  isPrivateMode?: boolean;
  isAuthenticated?: boolean;
  sessionStatus?: 'loading' | 'authenticated' | 'unauthenticated';
  user?: unknown;
}

export interface ConversationState {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  conversationId: string | null;
  isPublic: boolean;
  shareId: string | null;
  isInitialized: boolean;
  hasMoreMessages: boolean;
  isLoadingMore: boolean;
  ensureActiveConversation: () => Promise<string>;
  addUserMessage: (content: string) => Promise<void>;
  handleNewChat: () => Promise<void>;
  loadConversation: (conversation: ConversationSummary) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  updateToRemoteConversation: (remoteId: number) => void;
  isPrivateMode: boolean;
}

export function useConversationState({
  conversationStore,
  storage,
  activeConversationKey,
  isPrivateMode = false,
  isAuthenticated,
  sessionStatus,
  user,
}: UseConversationStateProps): ConversationState {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [shareId, setShareId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const previousActiveConversationKeyRef = useRef(activeConversationKey);
  const previousPrivateModeRef = useRef(isPrivateMode);
  const lastPersistenceKeyRef = useRef(activeConversationKey);
  const restoreRequestVersionRef = useRef(0);
  const restorePromiseRef = useRef<Promise<void> | null>(null);
  const loadConversationRequestVersionRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const [isInitialized, setIsInitialized] = useState(isPrivateMode);
  const hasInitializationStartedRef = useRef(isPrivateMode);
  const hasUser = Boolean(user);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const MESSAGES_PAGE_SIZE = 50;

  // Reset local state when switching storage namespace keys or private-mode boundaries.
  useEffect(() => {
    const activeKeyChanged = previousActiveConversationKeyRef.current !== activeConversationKey;
    const privateModeChanged = previousPrivateModeRef.current !== isPrivateMode;
    if (!activeKeyChanged && !privateModeChanged) {
      return;
    }

    previousActiveConversationKeyRef.current = activeConversationKey;
    previousPrivateModeRef.current = isPrivateMode;
    restoreRequestVersionRef.current += 1;
    loadConversationRequestVersionRef.current += 1;
    hasInitializationStartedRef.current = isPrivateMode;
    isLoadingMoreRef.current = false;
    setIsInitialized(isPrivateMode);
    setMessages([]);
    setConversationId(null);
    setIsPublic(false);
    setShareId(null);
    setHasMoreMessages(false);
    setIsLoadingMore(false);
    conversationIdRef.current = null;
  }, [activeConversationKey, isPrivateMode]);

  // Clear state when unauthenticated (if authentication state is provided)
  useEffect(() => {
    if (
      isAuthenticated !== undefined &&
      !isAuthenticated &&
      isInitialized &&
      sessionStatus !== 'loading'
    ) {
      restoreRequestVersionRef.current += 1;
      loadConversationRequestVersionRef.current += 1;
      setMessages([]);
      setConversationId(null);
      setIsPublic(false);
      setShareId(null);
      setHasMoreMessages(false);
      setIsLoadingMore(false);
      conversationIdRef.current = null;
      void Promise.resolve(storage.removeItem(activeConversationKey));
    }
  }, [isAuthenticated, isInitialized, sessionStatus, storage, activeConversationKey]);

  // Restore active conversation on mount
  useEffect(() => {
    if (isPrivateMode) {
      if (!isInitialized) {
        setIsInitialized(true);
      }
      return;
    }

    if (hasInitializationStartedRef.current) {
      return;
    }

    const canInitializeDuringSessionLoad = sessionStatus === 'loading' && isAuthenticated === true;
    if (sessionStatus === 'loading' && !canInitializeDuringSessionLoad) {
      return;
    }

    // Check if we should wait for authentication
    if (isAuthenticated !== undefined && !isAuthenticated) {
      if (!hasUser) {
        setIsInitialized(true);
        return;
      }
      if (sessionStatus !== 'loading') {
        setIsInitialized(true);
        return;
      }
    }

    hasInitializationStartedRef.current = true;
    const restoreRequestVersion = restoreRequestVersionRef.current + 1;
    restoreRequestVersionRef.current = restoreRequestVersion;
    const isStaleRestore = (): boolean =>
      restoreRequestVersion !== restoreRequestVersionRef.current;

    const restoreConversation = async () => {
      try {
        markLatency('conversation.restore.start');
        const snapshot = await restoreConversationSnapshot({
          conversationStore,
          storage,
          activeConversationKey,
          shouldAbort: isStaleRestore,
        });
        if (isStaleRestore() || snapshot === null) {
          if (!isStaleRestore()) {
            markLatency('conversation.restore.empty');
          }
          return;
        }

        conversationIdRef.current = snapshot.conversationId;
        setConversationId(snapshot.conversationId);
        setMessages(snapshot.messages);
        setHasMoreMessages(snapshot.hasMoreMessages);
        markLatency('conversation.restore.snapshot', {
          messageCount: snapshot.messages.length,
          hasMoreMessages: snapshot.hasMoreMessages,
        });
        logger.debug('[useConversationState] Restored conversation', {
          conversationId: snapshot.conversationId,
        });
      } catch (error) {
        if (isStaleRestore()) {
          return;
        }
        logger.error('[useConversationState] Failed to restore conversation', {
          error,
        });
        await storage.removeItem(activeConversationKey);
      } finally {
        if (!isStaleRestore()) {
          markLatency('conversation.initialized');
          setIsInitialized(true);
        }
      }
    };

    const restorePromise = restoreConversation();
    restorePromiseRef.current = restorePromise;
    void restorePromise.finally(() => {
      if (restorePromiseRef.current === restorePromise) {
        restorePromiseRef.current = null;
      }
    });
  }, [
    conversationStore,
    hasUser,
    isAuthenticated,
    isInitialized,
    isPrivateMode,
    sessionStatus,
    storage,
    activeConversationKey,
  ]);

  const ensureActiveConversation = useCallback(async (): Promise<string> => {
    if (conversationIdRef.current) {
      return conversationIdRef.current;
    }
    const pendingRestore = restorePromiseRef.current;
    if (!isInitialized && pendingRestore) {
      await pendingRestore;
      if (conversationIdRef.current) {
        return conversationIdRef.current;
      }
    }
    restoreRequestVersionRef.current += 1;
    isLoadingMoreRef.current = false;
    const freshId = createId(isPrivateMode ? 'private' : 'local');
    conversationIdRef.current = freshId;
    setConversationId(freshId);
    setHasMoreMessages(false);
    setIsLoadingMore(false);
    if (!isPrivateMode) {
      await conversationStore.ensureConversation(freshId, 'New Conversation');
      await storage.setItem(activeConversationKey, freshId);
    }
    return freshId;
  }, [conversationStore, isInitialized, isPrivateMode, storage, activeConversationKey]);

  const addUserMessage = useCallback(
    async (content: string) => {
      const activeConversationId = await ensureActiveConversation();
      const messageId = createId('user');
      const now = Date.now();
      const userMessage: Message = {
        id: messageId,
        content,
        role: 'user',
        sources: [],
        createdAt: now,
        updatedAt: now,
      };
      setMessages((previous) => [...previous, userMessage]);
      if (isPrivateMode) {
        return;
      }
      const conversationTitle = content.trim().slice(0, 120) || 'New Conversation';
      void (async () => {
        await conversationStore.ensureConversation(activeConversationId, conversationTitle);
        await conversationStore.upsertMessage({
          conversationId: activeConversationId,
          messageId,
          role: 'user',
          content,
          isStreaming: false,
          createdAt: now,
          updatedAt: now,
        });
      })().catch((error) => {
        logger.error('[useConversationState] Failed to persist user message', { error });
      });
      localSearch.addItem({
        id: messageId,
        title: conversationTitle,
        content,
        tags: [activeConversationId, 'user'],
      });
    },
    [conversationStore, ensureActiveConversation, isPrivateMode]
  );

  const handleNewChat = useCallback(async () => {
    restoreRequestVersionRef.current += 1;
    loadConversationRequestVersionRef.current += 1;

    if (isPrivateMode) {
      isLoadingMoreRef.current = false;
      conversationIdRef.current = null;
      setConversationId(null);
      setMessages([]);
      setIsPublic(false);
      setShareId(null);
      setHasMoreMessages(false);
      setIsLoadingMore(false);
      setIsInitialized(true);
      return;
    }

    const newId = createId('local');
    isLoadingMoreRef.current = false;
    conversationIdRef.current = newId;
    setConversationId(newId);
    setMessages([]);
    setIsPublic(false);
    setShareId(null);
    setHasMoreMessages(false);
    setIsLoadingMore(false);
    await conversationStore.ensureConversation(newId, 'New Conversation');
    await storage.setItem(activeConversationKey, newId);
  }, [conversationStore, isPrivateMode, storage, activeConversationKey]);

  const loadConversation = useCallback(
    async (conversation: ConversationSummary) => {
      const loadConversationRequestVersion = loadConversationRequestVersionRef.current + 1;
      loadConversationRequestVersionRef.current = loadConversationRequestVersion;
      const isStaleLoadRequest = (): boolean =>
        loadConversationRequestVersion !== loadConversationRequestVersionRef.current;

      try {
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
        const snapshot = await loadConversationSnapshot({
          conversationStore,
          conversation,
          pageSize: MESSAGES_PAGE_SIZE,
        });

        if (isStaleLoadRequest()) {
          return;
        }

        conversationIdRef.current = snapshot.conversationId;
        setConversationId(snapshot.conversationId);
        setMessages(snapshot.messages);
        setHasMoreMessages(snapshot.hasMoreMessages);
        setIsPublic(snapshot.isPublic);
        setShareId(snapshot.shareId);

        if (!isPrivateMode) {
          await storage.setItem(activeConversationKey, snapshot.conversationId);
        }
      } catch (error) {
        if (isStaleLoadRequest()) {
          return;
        }
        logger.error('Failed to load conversation', { error });
      }
    },
    [conversationStore, isPrivateMode, storage, activeConversationKey]
  );

  const loadMoreMessages = useCallback(async () => {
    if (!conversationId || isLoadingMoreRef.current || !hasMoreMessages) return;

    const targetConversationId = conversationId;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const offset = messages.length;
      const limit = MESSAGES_PAGE_SIZE;
      const { messages: moreMessages, hasMoreMessages: nextHasMoreMessages } =
        await loadMoreConversationMessages({
          conversationStore,
          conversationId: targetConversationId,
          offset,
          pageSize: limit,
        });
      if (conversationIdRef.current !== targetConversationId) {
        return;
      }

      if (moreMessages.length === 0) {
        setHasMoreMessages(false);
        return;
      }

      setMessages((prev) => [...prev, ...moreMessages]);
      setHasMoreMessages(nextHasMoreMessages);
    } catch (error) {
      logger.error('Failed to load more messages', { error });
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [conversationId, hasMoreMessages, messages.length, conversationStore]);

  useEffect(() => {
    if (!isInitialized) return;
    if (isPrivateMode) return;
    if (lastPersistenceKeyRef.current !== activeConversationKey) {
      lastPersistenceKeyRef.current = activeConversationKey;
      return;
    }

    if (!conversationId) {
      conversationIdRef.current = null;
      void storage.removeItem(activeConversationKey);
    } else {
      conversationIdRef.current = conversationId;
      void storage.setItem(activeConversationKey, conversationId);
    }
  }, [conversationId, isInitialized, isPrivateMode, storage, activeConversationKey]);

  const updateToRemoteConversation = useCallback(
    (remoteId: number) => {
      if (isPrivateMode) return;
      if (remoteId <= 0) return;
      const remoteConversationId = `remote-${remoteId}`;
      const previousConversationId = conversationIdRef.current;
      logger.debug('[useConversationState] Updating to remote conversation ID', {
        from: previousConversationId,
        to: remoteConversationId,
      });

      const applyRemoteConversationId = async () => {
        if (
          previousConversationId &&
          previousConversationId !== remoteConversationId &&
          previousConversationId.startsWith('local-') &&
          conversationStore.replaceConversationId
        ) {
          try {
            await conversationStore.replaceConversationId(
              previousConversationId,
              remoteConversationId
            );
          } catch (error) {
            logger.error('[useConversationState] Failed to migrate local conversation id', {
              error,
              from: previousConversationId,
              to: remoteConversationId,
            });
            return;
          }
        }

        if (conversationIdRef.current !== previousConversationId) {
          logger.debug('[useConversationState] Skipped stale remote conversation ID update', {
            expected: previousConversationId,
            current: conversationIdRef.current,
            to: remoteConversationId,
          });
          return;
        }

        conversationIdRef.current = remoteConversationId;
        setConversationId(remoteConversationId);
        await storage.setItem(activeConversationKey, remoteConversationId);
      };

      void applyRemoteConversationId();
    },
    [activeConversationKey, conversationStore, isPrivateMode, storage]
  );

  return {
    messages,
    setMessages,
    conversationId,
    isPublic,
    shareId,
    hasMoreMessages,
    isLoadingMore,
    isInitialized,
    ensureActiveConversation,
    addUserMessage,
    handleNewChat,
    loadConversation,
    loadMoreMessages,
    updateToRemoteConversation,
    isPrivateMode,
  };
}
