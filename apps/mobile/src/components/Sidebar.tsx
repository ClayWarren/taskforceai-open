import { GlassView } from 'expo-glass-effect';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  dedupeLocalSidebarConversations,
  filterSidebarConversations,
  filterSidebarConversationsByProject,
  createSidebarSearchText,
  mapLocalConversationToSidebarSummary,
} from '@taskforceai/presenters';
import { LocalSearch } from '@taskforceai/client-runtime/local-search';

import { useConversationsQuery, useDeleteConversationMutation } from '../hooks/api/conversations';
import { useAuth } from '../contexts/AuthContext';
import { useProjectsQuery } from '../hooks/api/projects';
import {
  archiveConversation,
  clearConversation,
  getConversationMessages,
  ingestRemoteConversationSummary,
  listArchivedConversations,
  listConversations,
} from '../storage/chat-local-mobile';
import type { LocalConversation } from '../storage/chat-local-mobile';
import { isGlassEffectSupported } from '../utils/glass';
import { styled } from '../utils/nativewind';
import { createModuleLogger } from '../logger';
import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import { SidebarView } from './Sidebar.view';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { Icon } from './Icon';

const StyledGlassView = styled(GlassView);
const StyledView = styled(View);
const logger = createModuleLogger('Sidebar');

type SidebarConversation = ConversationSummary & {
  searchable?: string;
  hasFullSearchText?: boolean;
};

type ConversationPagesData = {
  pages?: readonly (readonly ConversationSummary[])[];
};

const getConversationPages = (data: unknown): readonly (readonly ConversationSummary[])[] => {
  const pages = (data as ConversationPagesData | undefined)?.pages;
  return Array.isArray(pages) ? pages : [];
};

const collectChangedRemoteSummaries = (
  pages: readonly (readonly ConversationSummary[])[],
  ingestedRemoteLookup: ReadonlyMap<number, string>
): ConversationSummary[] => {
  const changed: ConversationSummary[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    for (let index = 0; index < page.length; index++) {
      const summary = page[index];
      const prev = ingestedRemoteLookup.get(summary.id);
      const current = summary.timestamp;
      if (!prev || prev !== current) {
        changed.push(summary);
      }
    }
  }
  return changed;
};

interface SidebarProps {
  visible: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onConversationSelect?: (conversation: ConversationSummary) => void;
  isAuthenticated?: boolean;
  onSettingsPress?: () => void;
  onDesktopSessionsPress?: () => void;
  onArtifactsPress?: () => void;
  onFinancePress?: () => void;
  onScheduledPress?: () => void;
  onPluginsPress?: () => void;
}

export function Sidebar({
  visible,
  onClose,
  onNewChat,
  onConversationSelect,
  isAuthenticated = false,
  onSettingsPress,
  onDesktopSessionsPress,
  onArtifactsPress,
  onFinancePress,
  onScheduledPress,
  onPluginsPress,
}: SidebarProps) {
  const [localConversations, setLocalConversations] = useState<SidebarConversation[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isProjectsVisible, setIsProjectsVisible] = useState(false);
  const [archivedConversationIds, setArchivedConversationIds] = useState<Set<string>>(() => new Set());
  const insets = useSafeAreaInsets();
  const localConversationLookup = useRef<Map<number, string>>(new Map());
  const localConversationRecords = useRef<Map<number, LocalConversation>>(new Map());
  const ingestedRemoteLookup = useRef<Map<number, string>>(new Map()); // id -> updatedAt
  const conversationsQuery = useConversationsQuery({
    enabled: visible && isAuthenticated,
  });
  const projectsQuery = useProjectsQuery({
    enabled: visible && isAuthenticated,
  });
  const projects = projectsQuery.data ?? [];

  const remoteConversations = useMemo<SidebarConversation[]>(() => {
    if (!isAuthenticated) {
      return [];
    }
    return getConversationPages(conversationsQuery.data)
      .flat()
      .filter((conversation) => !archivedConversationIds.has(`remote-${conversation.id}`))
      .map((conversation) =>
        Object.assign({}, conversation, {
          searchable: `${conversation.user_input ?? ''} ${conversation.result ?? ''}`,
        })
      );
  }, [archivedConversationIds, conversationsQuery.data, isAuthenticated]);

  useEffect(() => {
    if (!visible || !isAuthenticated) {
      return;
    }
    const pages = getConversationPages(conversationsQuery.data);
    if (!pages.length) {
      return;
    }
    void (async () => {
      const changed = collectChangedRemoteSummaries(pages, ingestedRemoteLookup.current);
      if (!changed.length) {
        return;
      }
      await Promise.all(changed.map((summary) => ingestRemoteConversationSummary(summary)));
      changed.forEach((summary) => ingestedRemoteLookup.current.set(summary.id, summary.timestamp));
    })();
  }, [conversationsQuery.data, isAuthenticated, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    if (!isAuthenticated) {
      localConversationLookup.current.clear();
      localConversationRecords.current.clear();
      setLocalConversations([]);
      setArchivedConversationIds(new Set());
      return;
    }
    void loadLocalConversations();
  }, [isAuthenticated, visible]);

  const loadLocalConversations = async () => {
    try {
      const [result, archivedResult] = await Promise.all([
        listConversations(),
        listArchivedConversations(500),
      ]);
      if (!result.ok) {
        logger.error('Failed to load local conversations', { error: result.error });
        return;
      }
      if (archivedResult.ok) {
        setArchivedConversationIds(
          new Set(archivedResult.value.map((conversation) => conversation.conversationId))
        );
      } else {
        logger.error('Failed to load archived local conversations', { error: archivedResult.error });
      }
      const locals = result.value;
      localConversationLookup.current.clear();
      localConversationRecords.current.clear();

      const enriched = locals.map((conversation, index) => {
        const syntheticId = -(index + 1);
        localConversationLookup.current.set(syntheticId, conversation.conversationId);
        localConversationRecords.current.set(syntheticId, conversation);

        return Object.assign(
          mapLocalConversationToSidebarSummary(conversation, {
            syntheticId,
          }),
          {
            id: syntheticId,
            model: conversation.conversationId,
            hasFullSearchText: false,
          }
        ) as SidebarConversation;
      });

      setLocalConversations(enriched);
    } catch (error) {
      logger.error('Failed to load local conversations', { error });
    }
  };

  useEffect(() => {
    if (!visible || !isAuthenticated || !searchQuery.trim()) {
      return;
    }

    const localIdsNeedingSearchText = localConversations
      .filter((conversation) => conversation.id < 0 && !conversation.hasFullSearchText)
      .map((conversation) => conversation.id);
    if (localIdsNeedingSearchText.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const updates = await Promise.all(
        localIdsNeedingSearchText.map(async (syntheticId) => {
          const conversationId = localConversationLookup.current.get(syntheticId);
          const localRecord = localConversationRecords.current.get(syntheticId);
          if (!conversationId || !localRecord) {
            return null;
          }

          const messagesResult = await getConversationMessages(conversationId);
          const messageContents = messagesResult.ok
            ? messagesResult.value.map((message) => message.content)
            : [];

          return {
            syntheticId,
            searchable: createSidebarSearchText({
              title: localRecord.title,
              lastMessagePreview: localRecord.lastMessagePreview,
              messageContents,
            }),
          };
        })
      );

      if (cancelled) {
        return;
      }

      const updateLookup = new Map(
        updates
          .filter((update): update is NonNullable<typeof update> => update !== null)
          .map((update) => [update.syntheticId, update.searchable])
      );
      if (updateLookup.size === 0) {
        return;
      }

      setLocalConversations((current) =>
        current.map((conversation) => {
          const searchable = updateLookup.get(conversation.id);
          if (searchable === undefined) {
            return conversation;
          }
          return { ...conversation, searchable, hasFullSearchText: true };
        })
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, localConversations, searchQuery, visible]);

  const projectScopedConversations = useMemo(() => {
    if (!isAuthenticated) {
      return [];
    }
    const uniqueLocal = dedupeLocalSidebarConversations(
      localConversations,
      remoteConversations,
      (syntheticId) => localConversationLookup.current.get(syntheticId)
    );
    const dataset = [...remoteConversations, ...uniqueLocal];
    return filterSidebarConversationsByProject(dataset, activeProjectId);
  }, [activeProjectId, isAuthenticated, localConversations, remoteConversations]);

  const localSearch = useMemo(() => new LocalSearch(), []);

  const filteredConversations = useMemo(() => {
    return filterSidebarConversations(projectScopedConversations, searchQuery, localSearch);
  }, [projectScopedConversations, searchQuery, localSearch]);

  const handleConversationPress = useCallback(
    (conversationId: number) => {
      let conversation =
        remoteConversations.find((conv) => conv.id === conversationId) ||
        localConversations.find((conv) => conv.id === conversationId);
      if (!conversation) {
        return;
      }

      if (conversationId < 0) {
        const actualId = localConversationLookup.current.get(conversationId);
        if (actualId) {
          conversation = { ...conversation, model: actualId };
        }
      }

      if (conversation) {
        onConversationSelect?.(conversation);
      }
      onClose();
    },
    [localConversations, onClose, onConversationSelect, remoteConversations]
  );

  const deleteConversationMutation = useDeleteConversationMutation();

  const handleDeleteConversation = (conversationId: number, title?: string) => {
    Keyboard.dismiss();
    Alert.alert(
      'Delete Conversation',
      `Are you sure you want to delete "${title || 'this conversation'}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                if (conversationId < 0) {
                  const localId = localConversationLookup.current.get(conversationId);
                  if (localId) {
                    await clearConversation(localId);
                  }
                  await loadLocalConversations();
                } else {
                  await deleteConversationMutation.mutateAsync(conversationId);
                  const mirroredLocalConversationId = `remote-${conversationId}`;
                  await clearConversation(mirroredLocalConversationId);
                  ingestedRemoteLookup.current.delete(conversationId);
                  await loadLocalConversations();
                }
              } catch (error) {
                logger.error('Failed to delete conversation', { error, conversationId });
                Alert.alert('Error', 'Failed to delete conversation');
              }
            })();
          },
        },
      ]
    );
  };

  const handleArchiveConversation = (conversationId: number, title?: string) => {
    Keyboard.dismiss();
    Alert.alert(
      'Archive Conversation',
      `Archive "${title || 'this conversation'}"? You can restore it from Data controls.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          onPress: () => {
            void (async () => {
              try {
                if (conversationId < 0) {
                  const localId = localConversationLookup.current.get(conversationId);
                  if (localId) {
                    await archiveConversation(localId);
                  }
                } else {
                  const remoteConversation = remoteConversations.find((conv) => conv.id === conversationId);
                  if (remoteConversation) {
                    await ingestRemoteConversationSummary(remoteConversation);
                  }
                  await archiveConversation(`remote-${conversationId}`);
                  ingestedRemoteLookup.current.delete(conversationId);
                }
                await loadLocalConversations();
              } catch (error) {
                logger.error('Failed to archive conversation', { error, conversationId });
                Alert.alert('Error', 'Failed to archive conversation');
              }
            })();
          },
        },
      ]
    );
  };

  const handleConversationActions = (conversationId: number, title?: string) => {
    Keyboard.dismiss();
    Alert.alert(title || 'Conversation', undefined, [
      {
        text: 'Archive',
        onPress: () => handleArchiveConversation(conversationId, title),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => handleDeleteConversation(conversationId, title),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const { user } = useAuth();
  const userInitials = (user?.full_name ?? user?.email ?? 'TF')
    .split(' ')
    .map((p) => p.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const userName = user?.full_name ?? user?.email ?? '';

  const useGlass = isGlassEffectSupported();
  const SidebarComponent = useGlass ? StyledGlassView : StyledView;

  const handleManageProjects = () => {
    onClose();
    globalThis.setTimeout(() => setIsProjectsVisible(true), 0);
  };

  const handleProjectSelect = (projectId: number | null) => {
    setActiveProjectId(projectId);
    setIsProjectsVisible(false);
  };

  const handleEndReached = useCallback(() => {
    if (conversationsQuery.hasNextPage && !conversationsQuery.isFetchingNextPage) {
      void conversationsQuery.fetchNextPage();
    }
  }, [conversationsQuery]);

  return (
    <>
      <SidebarView
        visible={visible}
        onClose={onClose}
        onNewChat={onNewChat}
        isAuthenticated={isAuthenticated}
        insets={insets}
        SidebarComponent={SidebarComponent}
        useGlass={useGlass}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onManageProjects={handleManageProjects}
        filteredConversations={filteredConversations}
        handleConversationPress={handleConversationPress}
        handleDeleteConversation={handleConversationActions}
        userName={userName}
        userInitials={userInitials}
        onSettingsPress={onSettingsPress}
        onEndReached={handleEndReached}
        isLoadingMore={conversationsQuery.isFetchingNextPage}
        desktopSessionsSlot={
          isAuthenticated ? (
            <>
              <TouchableOpacity
                onPress={onScheduledPress}
                activeOpacity={0.72}
                style={styles.productNavRow}
                accessibilityRole="button"
                accessibilityLabel="Open Scheduled"
              >
                <Icon name="Clock3" size={18} color="#f8fafc" />
                <Text style={styles.productNavText}>Scheduled</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onPluginsPress}
                activeOpacity={0.72}
                style={styles.productNavRow}
                accessibilityRole="button"
                accessibilityLabel="Open Plugins"
              >
                <Icon name="Cpu" size={18} color="#f8fafc" />
                <Text style={styles.productNavText}>Plugins</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onArtifactsPress}
                activeOpacity={0.72}
                style={styles.productNavRow}
                accessibilityRole="button"
                accessibilityLabel="Open Artifacts"
              >
                <Icon name="FileText" size={18} color="#f8fafc" />
                <Text style={styles.productNavText}>Artifacts</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onFinancePress}
                activeOpacity={0.72}
                style={styles.productNavRow}
                accessibilityRole="button"
                accessibilityLabel="Open Finance"
              >
                <Icon name="CreditCard" size={18} color="#f8fafc" />
                <Text style={styles.productNavText}>Finance</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onDesktopSessionsPress}
                activeOpacity={0.72}
                style={styles.productNavRow}
                accessibilityRole="button"
                accessibilityLabel="Open Remote"
              >
                <Icon name="Monitor" size={18} color="#f8fafc" />
                <Text style={styles.productNavText}>Remote</Text>
              </TouchableOpacity>
            </>
          ) : null
        }
      />
      <ProjectsScreen
        visible={isProjectsVisible}
        onClose={() => setIsProjectsVisible(false)}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleProjectSelect}
      />
    </>
  );
}

const styles = StyleSheet.create({
  productNavRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  productNavText: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
  },
});
