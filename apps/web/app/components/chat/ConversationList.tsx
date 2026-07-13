'use client';

import { type ConversationSummary } from '@taskforceai/contracts/contracts';
import { ingestRemoteConversationSummary } from '@taskforceai/client-runtime';
import { localSearch } from '@taskforceai/client-runtime/local-search';
import { filterSidebarConversationsByProject } from '@taskforceai/presenters/sidebar/view-model';
import { type Result, err, ok } from '@taskforceai/client-core/result';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchConversationsPage } from '../../lib/api/conversations';
import { logger } from '../../lib/logger';
import { useConversationStore } from '../../lib/platform/PlatformProvider';
import { useProjects } from '../../lib/projects/ProjectsContext';
import { useAuth } from '../../lib/providers/AuthProvider';
import { useOptionalSync } from '../../lib/providers/SyncProvider';
import { ConversationListView } from './ConversationListView';
import { useConversationDeleteHandler } from './useConversationDeleteHandler';
import {
  createConversationSearchItem,
  mapLocalConversationToSummary,
} from './conversation-list-mapping';
import { readPinnedConversationIds, writePinnedConversationIds } from './pinned-conversations';

interface ConversationListProps {
  onConversationSelect?: (_conversation: ConversationSummary) => void;
  onConversationClick?: () => void; // Function to handle conversation click (e.g., to close sidebar)
  showSearch?: boolean;
  /** External search query; when provided, overrides the internal search input. */
  searchQuery?: string;
  activeConversationId?: string | null;
}

const normalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

type ConversationLoadMode = 'reset' | 'append' | 'preserve-loaded';

const ConversationList: React.FC<ConversationListProps> = ({
  onConversationSelect,
  onConversationClick,
  showSearch = true,
  searchQuery: externalSearchQuery,
  activeConversationId,
}) => {
  const { isAuthenticated, isTokenReady } = useAuth();
  const syncContext = useOptionalSync();
  const { activeProjectId } = useProjects();
  const conversationStore = useConversationStore();
  const [localConversations, setLocalConversations] = useState<ConversationSummary[]>([]);
  const loadedCountRef = useRef(0);
  const emptyCacheSyncAttemptedRef = useRef(false);
  const remotePageFetchAttemptedRef = useRef<Set<string>>(new Set());
  const remoteBackfillInFlightRef = useRef(false);
  const syncRef = useRef<{
    enabled: boolean;
    isOnline: boolean;
    sync: ((options?: { throwOnError?: boolean }) => Promise<void>) | null;
  }>({
    enabled: false,
    isOnline: true,
    sync: null,
  });
  const localConversationLookup = useRef<Map<number, string>>(new Map());
  const localConversationReverseLookup = useRef<Map<string, number>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ConversationSummary[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const [pinnedConversationIds, setPinnedConversationIds] = useState<Set<string>>(new Set());
  const activeConvIdRef = useRef<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const CONVERSATIONS_PAGE_SIZE = 20;
  const syncLastSyncTime = syncContext?.syncState.lastSyncTime ?? 0;

  useEffect(() => {
    setPinnedConversationIds(readPinnedConversationIds());
  }, []);

  useEffect(() => {
    syncRef.current = {
      enabled: syncContext?.enabled === true,
      isOnline: syncContext?.isOnline !== false,
      sync: syncContext?.sync ?? null,
    };
  }, [syncContext?.enabled, syncContext?.isOnline, syncContext?.sync]);

  useEffect(() => {
    activeConvIdRef.current = activeConversationId ?? null;
    if (activeConversationId) {
      setUnreadIds((prev) => {
        if (!prev.has(activeConversationId)) return prev;
        const next = new Set(prev);
        next.delete(activeConversationId);
        return next;
      });
    }
  }, [activeConversationId]);

  const conversationsToRender = useMemo(() => {
    return filterSidebarConversationsByProject(localConversations, activeProjectId, {
      preserveWhenMissingProjectIds: true,
    });
  }, [localConversations, activeProjectId]);

  const repairEmptyLocalCache = useCallback(
    async (
      locals: Awaited<ReturnType<typeof conversationStore.listConversations>>,
      limit: number,
      offset: number,
      eligible: boolean
    ) => {
      if (!eligible || locals.length > 0 || emptyCacheSyncAttemptedRef.current) return locals;
      const sync = syncRef.current;
      if (!sync.enabled || !sync.isOnline || !sync.sync) return locals;
      emptyCacheSyncAttemptedRef.current = true;
      try {
        await sync.sync({ throwOnError: true });
        return await conversationStore.listConversations(limit, offset);
      } catch (error) {
        logger.warn('Failed to repair empty local conversation cache via sync', {
          error: normalizeError(error),
        });
        return locals;
      }
    },
    [conversationStore]
  );

  const backfillRemotePage = useCallback(
    async (
      locals: Awaited<ReturnType<typeof conversationStore.listConversations>>,
      limit: number,
      offset: number,
      eligible: boolean
    ) => {
      const remotePageKey = `${limit}:${offset}`;
      if (!eligible || !isTokenReady || remotePageFetchAttemptedRef.current.has(remotePageKey)) {
        return { locals, remoteHasMore: null as boolean | null };
      }
      remotePageFetchAttemptedRef.current.add(remotePageKey);
      try {
        const remotePage = await fetchConversationsPage(limit, offset);
        if (!remotePage || remotePage.conversations.length === 0) {
          return { locals, remoteHasMore: remotePage?.hasMore ?? null };
        }
        remoteBackfillInFlightRef.current = true;
        await Promise.all(
          remotePage.conversations.map((conversation) =>
            ingestRemoteConversationSummary({ conversationStore, conversation })
          )
        );
        return {
          locals: await conversationStore.listConversations(limit, offset),
          remoteHasMore: remotePage.hasMore,
        };
      } catch (error) {
        logger.warn('Failed to backfill local conversation cache from API', {
          error: normalizeError(error),
          limit,
          offset,
        });
        return { locals, remoteHasMore: null as boolean | null };
      } finally {
        remoteBackfillInFlightRef.current = false;
      }
    },
    [conversationStore, isTokenReady]
  );

  const loadLocalConversations = useCallback(
    async (mode: ConversationLoadMode = 'reset') => {
      if (!isAuthenticated) {
        setLocalConversations([]);
        loadedCountRef.current = 0;
        emptyCacheSyncAttemptedRef.current = false;
        remotePageFetchAttemptedRef.current.clear();
        localConversationLookup.current.clear();
        localConversationReverseLookup.current.clear();
        setHasMore(false);
        setIsInitialLoading(false);
        return;
      }

      const isAppend = mode === 'append';
      const isPreservingLoaded = mode === 'preserve-loaded';
      const shouldShowInitialLoading =
        !isAppend && !isPreservingLoaded && loadedCountRef.current === 0;

      if (isAppend) {
        setIsLoadingMore(true);
      }
      if (shouldShowInitialLoading) {
        setIsInitialLoading(true);
      }

      try {
        const offset = isAppend ? loadedCountRef.current : 0;
        const limit = isPreservingLoaded
          ? Math.max(loadedCountRef.current, CONVERSATIONS_PAGE_SIZE)
          : CONVERSATIONS_PAGE_SIZE;
        let locals = await conversationStore.listConversations(limit, offset);

        locals = await repairEmptyLocalCache(
          locals,
          limit,
          offset,
          !isAppend && !isPreservingLoaded
        );
        const remotePage = await backfillRemotePage(locals, limit, offset, !isPreservingLoaded);
        locals = remotePage.locals;
        const remoteHasMore = remotePage.remoteHasMore;

        if (!isAppend) {
          localConversationLookup.current.clear();
          localConversationReverseLookup.current.clear();
          loadedCountRef.current = 0;
        }

        if (isAppend) {
          loadedCountRef.current += locals.length;
        } else {
          loadedCountRef.current = locals.length;
        }

        const mapped = locals.map((conversation, index) => {
          const syntheticId = -(offset + index + 1);
          localConversationLookup.current.set(syntheticId, conversation.conversationId);
          localConversationReverseLookup.current.set(conversation.conversationId, syntheticId);
          return mapLocalConversationToSummary(conversation, syntheticId);
        });

        if (isAppend) {
          setLocalConversations((prev) => [...prev, ...mapped]);
        } else {
          setLocalConversations(mapped);
        }

        setHasMore(locals.length === limit || remoteHasMore === true);

        // Initialize search with conversations (content preview)
        // For search, we still want to keep the search index updated without wiping others.
        const searchItems = locals.map(createConversationSearchItem);
        searchItems.forEach((item) => localSearch.addItem(item));
      } catch (error: unknown) {
        const normalizedError = normalizeError(error);
        logger.error('Failed to load local conversations', { error: normalizedError });
      } finally {
        if (shouldShowInitialLoading) {
          setIsInitialLoading(false);
        }
        setIsLoadingMore(false);
      }
    },
    [backfillRemotePage, conversationStore, isAuthenticated, repairEmptyLocalCache]
  );

  const removePinnedConversation = useCallback((conversationId: string) => {
    setPinnedConversationIds((current) => {
      if (!current.has(conversationId)) return current;
      const next = new Set(current);
      next.delete(conversationId);
      writePinnedConversationIds(next);
      return next;
    });
  }, []);

  const handleDeleteConversation = useConversationDeleteHandler({
    conversationStore,
    localConversationLookup,
    localConversationReverseLookup,
    reloadConversations: () => loadLocalConversations('preserve-loaded'),
    onDeleted: removePinnedConversation,
  });

  const handlePinConversation = useCallback((id: number) => {
    const conversationId = localConversationLookup.current.get(id);
    if (!conversationId) {
      logger.warn('Pin conversation aborted: local conversation mapping missing', { id });
      return;
    }

    setPinnedConversationIds((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      if (!writePinnedConversationIds(next)) {
        logger.warn('Failed to persist pinned conversations');
      }
      return next;
    });
  }, []);

  const handleArchiveConversation = useCallback(
    async (id: number) => {
      if (!Number.isFinite(id)) {
        logger.warn('Archive conversation aborted: invalid conversation id', { id });
        return;
      }

      const localId = localConversationLookup.current.get(id);
      if (!localId) {
        logger.warn('Archive conversation aborted: local conversation mapping missing', { id });
        return;
      }

      if (!conversationStore.archiveConversation) {
        logger.warn('Archive conversation aborted: store does not support archive', {
          id,
          localId,
        });
        return;
      }

      try {
        await conversationStore.archiveConversation(localId);
        removePinnedConversation(localId);
        localConversationLookup.current.delete(id);
        localConversationReverseLookup.current.delete(localId);
        await loadLocalConversations('preserve-loaded');
      } catch (error) {
        logger.error('Failed to archive local conversation', {
          id,
          localId,
          error: normalizeError(error),
        });
      }
    },
    [conversationStore, loadLocalConversations, removePinnedConversation]
  );

  const handleConversationClick = (id: number) => {
    const actualId = localConversationLookup.current.get(id);
    if (actualId) {
      activeConvIdRef.current = actualId;
      setUnreadIds((prev) => {
        if (!prev.has(actualId)) return prev;
        const next = new Set(prev);
        next.delete(actualId);
        return next;
      });
    }

    let conversation = localConversations.find((conv) => conv.id === id);
    if (conversation && onConversationSelect) {
      if (actualId) {
        conversation = { ...conversation, model: actualId };
      }
      onConversationSelect(conversation);
    }
    if (onConversationClick) {
      onConversationClick();
    }
  };

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const startRename = useCallback(
    (id: number) => {
      const summary = localConversations.find((conv) => conv.id === id);
      const currentTitle = summary?.user_input?.trim() || 'Conversation';
      setEditingId(id);
      setEditingValue(currentTitle);
    },
    [localConversations]
  );

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditingValue('');
  }, []);

  const commitRename = useCallback(async () => {
    if (editingId === null) {
      return;
    }
    const trimmed = editingValue.trim();
    if (!trimmed) {
      return;
    }
    const actualId = localConversationLookup.current.get(editingId);
    if (!actualId) {
      return;
    }
    await conversationStore.renameConversation(actualId, trimmed);
    setEditingId(null);
    setEditingValue('');
    await loadLocalConversations('preserve-loaded');
  }, [conversationStore, editingId, editingValue, loadLocalConversations]);

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!mountedRef.current) return;
      await loadLocalConversations();
    };
    void load();
  }, [isAuthenticated, loadLocalConversations]);

  useEffect(() => {
    if (!isAuthenticated || syncLastSyncTime <= 0) {
      return;
    }
    void loadLocalConversations('preserve-loaded');
  }, [isAuthenticated, loadLocalConversations, syncLastSyncTime]);

  useEffect(() => {
    const unsubscribe = conversationStore.subscribe((event) => {
      if (!mountedRef.current) return;
      if (remoteBackfillInFlightRef.current) return;
      if (event.type === 'conversations-changed' || event.type === 'messages-changed') {
        void loadLocalConversations('preserve-loaded');
      }
      if (event.type === 'messages-changed' && event.conversationId !== activeConvIdRef.current) {
        setUnreadIds((prev) => {
          if (prev.has(event.conversationId)) return prev;
          const next = new Set(prev);
          next.add(event.conversationId);
          return next;
        });
      }
    });
    return unsubscribe;
  }, [conversationStore, loadLocalConversations]);

  const resolveConversationSummary = useCallback(
    (convId: string): Result<ConversationSummary, 'NOT_FOUND'> => {
      const syntheticId = localConversationReverseLookup.current.get(convId);
      if (syntheticId === undefined) {
        return err('NOT_FOUND');
      }
      const local = localConversations.find((conv) => conv.id === syntheticId);
      if (local) {
        return ok(local);
      }
      return err('NOT_FOUND');
    },
    [localConversations]
  );

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSearchQuery = externalSearchQuery !== undefined ? externalSearchQuery : searchQuery;

  useEffect(() => {
    if (!activeSearchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const matches = localSearch.search(activeSearchQuery.trim());
      const dedup = new Map<number, ConversationSummary>();
      matches.forEach((item) => {
        // Try each tag as a potential conversationId directly. This avoids
        // relying on a 'local-'/'remote-' prefix heuristic and instead uses the
        // lookup map which is the source of truth (bug #16).
        for (const tag of item.tags ?? []) {
          if (!tag) continue;
          const summaryResult = resolveConversationSummary(tag);
          if (summaryResult.ok) {
            dedup.set(summaryResult.value.id, summaryResult.value);
            break;
          }
        }
      });
      setSearchResults(Array.from(dedup.values()));
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [activeSearchQuery, localConversations, resolveConversationSummary]);

  const listToRender = useMemo(() => {
    const conversations = activeSearchQuery.trim() ? searchResults : conversationsToRender;
    return conversations.toSorted((left, right) => {
      const leftId = localConversationLookup.current.get(left.id);
      const rightId = localConversationLookup.current.get(right.id);
      const leftPinned = leftId ? pinnedConversationIds.has(leftId) : false;
      const rightPinned = rightId ? pinnedConversationIds.has(rightId) : false;
      return Number(rightPinned) - Number(leftPinned);
    });
  }, [activeSearchQuery, conversationsToRender, pinnedConversationIds, searchResults]);

  return (
    <ConversationListView
      activeSearchQuery={activeSearchQuery}
      activeConversationId={activeConversationId}
      editingId={editingId}
      editingValue={editingValue}
      getActualConversationId={(id) => localConversationLookup.current.get(id)}
      hasMore={hasMore}
      isInitialLoading={isInitialLoading}
      isLoadingMore={isLoadingMore}
      listToRender={listToRender}
      onArchiveConversation={handleArchiveConversation}
      onConversationClick={handleConversationClick}
      onDeleteConversation={handleDeleteConversation}
      onEditCancel={cancelRename}
      onEditChange={setEditingValue}
      onEditSubmit={commitRename}
      onLoadMore={() => {
        void loadLocalConversations('append');
      }}
      onPinConversation={handlePinConversation}
      onRenameRequest={startRename}
      onSearchChange={setSearchQuery}
      searchQuery={searchQuery}
      showSearch={showSearch}
      unreadIds={unreadIds}
      pinnedConversationIds={pinnedConversationIds}
    />
  );
};

export default ConversationList;
