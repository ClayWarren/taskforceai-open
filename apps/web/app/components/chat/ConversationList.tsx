'use client';

import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import { localSearch } from '@taskforceai/shared';
import { filterSidebarConversationsByProject } from '@taskforceai/shared/sidebar/view-model';
import { type Result, err, ok } from '@taskforceai/shared/result';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { logger } from '../../lib/logger';
import { useConversationStore } from '../../lib/platform/PlatformProvider';
import { useProjects } from '../../lib/projects/ProjectsContext';
import { useAuth } from '../../lib/providers/AuthProvider';
import { ConversationListView } from './ConversationListView';
import { useConversationDeleteHandler } from './useConversationDeleteHandler';
import {
  createConversationSearchItem,
  mapLocalConversationToSummary,
} from './conversation-list-mapping';

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
  const { isAuthenticated } = useAuth();
  const { activeProjectId } = useProjects();
  const conversationStore = useConversationStore();
  const [localConversations, setLocalConversations] = useState<ConversationSummary[]>([]);
  const loadedCountRef = useRef(0);
  const localConversationLookup = useRef<Map<number, string>>(new Map());
  const localConversationReverseLookup = useRef<Map<string, number>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ConversationSummary[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const activeConvIdRef = useRef<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const CONVERSATIONS_PAGE_SIZE = 20;

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

  const loadLocalConversations = useCallback(
    async (mode: ConversationLoadMode = 'reset') => {
      if (!isAuthenticated) {
        setLocalConversations([]);
        localConversationLookup.current.clear();
        localConversationReverseLookup.current.clear();
        setHasMore(false);
        return;
      }

      const isAppend = mode === 'append';
      const isPreservingLoaded = mode === 'preserve-loaded';

      if (isAppend) {
        setIsLoadingMore(true);
      }

      try {
        const offset = isAppend ? loadedCountRef.current : 0;
        const limit = isPreservingLoaded
          ? Math.max(loadedCountRef.current, CONVERSATIONS_PAGE_SIZE)
          : CONVERSATIONS_PAGE_SIZE;
        const locals = await conversationStore.listConversations(limit, offset);

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

        setHasMore(locals.length === limit);

        // Initialize search with conversations (content preview)
        // For search, we still want to keep the search index updated without wiping others.
        const searchItems = locals.map(createConversationSearchItem);
        searchItems.forEach((item) => localSearch.addItem(item));
      } catch (error: unknown) {
        const normalizedError = normalizeError(error);
        logger.error('Failed to load local conversations', { error: normalizedError });
      } finally {
        setIsLoadingMore(false);
      }
    },
    [conversationStore, isAuthenticated]
  );

  const handleDeleteConversation = useConversationDeleteHandler({
    conversationStore,
    localConversationLookup,
    localConversationReverseLookup,
    reloadConversations: () => loadLocalConversations('preserve-loaded'),
  });

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
    [conversationStore, loadLocalConversations]
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
    const unsubscribe = conversationStore.subscribe((event) => {
      if (!mountedRef.current) return;
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

  const listToRender = activeSearchQuery.trim() ? searchResults : conversationsToRender;

  return (
    <ConversationListView
      activeSearchQuery={activeSearchQuery}
      activeConversationId={activeConversationId}
      editingId={editingId}
      editingValue={editingValue}
      getActualConversationId={(id) => localConversationLookup.current.get(id)}
      hasMore={hasMore}
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
      onRenameRequest={startRename}
      onSearchChange={setSearchQuery}
      searchQuery={searchQuery}
      showSearch={showSearch}
      unreadIds={unreadIds}
    />
  );
};

export default ConversationList;
