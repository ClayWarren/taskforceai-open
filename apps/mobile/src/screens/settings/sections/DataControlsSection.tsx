import React from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSync } from '../../../contexts/SyncContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { ActionButton } from '../../../components/ActionButton';
import { Icon } from '../../../components/Icon';
import { Section, InfoBox, SettingRow } from '../components';
import {
  archiveAllConversations,
  clearConversation,
  deleteAllConversations,
  listArchivedConversations,
  restoreConversation,
  type LocalConversation,
} from '../../../storage/chat-local-mobile';
import { createModuleLogger } from '../../../logger';

const logger = createModuleLogger('DataControlsSection');

type ArchivedConversation = Pick<
  LocalConversation,
  'conversationId' | 'title' | 'createdAt' | 'updatedAt' | 'lastMessagePreview'
>;

interface DataControlsSectionProps {
  onClearCache: () => void;
  onForceSync: () => Promise<void>;
  onResetDatabase: () => void;
  isAdmin: boolean;
}

export function DataControlsSection({
  onClearCache,
  onForceSync,
  onResetDatabase,
  isAdmin,
}: DataControlsSectionProps) {
  const { t } = useTranslation();
  const { syncState } = useSync();
  const { theme } = useTheme();
  const [archivedChatsVisible, setArchivedChatsVisible] = React.useState(false);
  const [archivedChats, setArchivedChats] = React.useState<ArchivedConversation[]>([]);
  const [archivedChatsLoading, setArchivedChatsLoading] = React.useState(false);
  const [archivedChatsError, setArchivedChatsError] = React.useState<string | null>(null);
  const [archivedSearchQuery, setArchivedSearchQuery] = React.useState('');
  const [archiveActionId, setArchiveActionId] = React.useState<string | null>(null);

  const loadArchivedChats = React.useCallback(async () => {
    setArchivedChatsLoading(true);
    setArchivedChatsError(null);
    try {
      const result = await listArchivedConversations(200);
      if (!result.ok) {
        throw result.error;
      }
      setArchivedChats(result.value);
    } catch (error) {
      logger.error('Failed to load archived chats', { error });
      setArchivedChatsError(t('mobile.settings.archivedChatsLoadFailed', {
        defaultValue: 'Failed to load archived chats.',
      }));
    } finally {
      setArchivedChatsLoading(false);
    }
  }, [t]);

  const openArchivedChats = React.useCallback(() => {
    setArchivedChatsVisible(true);
    void loadArchivedChats();
  }, [loadArchivedChats]);

  const restoreArchivedChat = React.useCallback(
    (conversationId: string) => {
      setArchiveActionId(`restore:${conversationId}`);
      setArchivedChatsError(null);
      void (async () => {
        try {
          await restoreConversation(conversationId);
          await loadArchivedChats();
        } catch (error) {
          logger.error('Failed to restore archived chat', { conversationId, error });
          setArchivedChatsError(t('mobile.settings.restoreArchivedChatFailed', {
            defaultValue: 'Failed to restore archived chat.',
          }));
        } finally {
          setArchiveActionId(null);
        }
      })();
    },
    [loadArchivedChats, t]
  );

  const deleteArchivedChat = React.useCallback(
    (conversationId: string) => {
      setArchiveActionId(`delete:${conversationId}`);
      setArchivedChatsError(null);
      void (async () => {
        try {
          await clearConversation(conversationId);
          await loadArchivedChats();
        } catch (error) {
          logger.error('Failed to delete archived chat', { conversationId, error });
          setArchivedChatsError(t('mobile.settings.deleteArchivedChatFailed', {
            defaultValue: 'Failed to delete archived chat.',
          }));
        } finally {
          setArchiveActionId(null);
        }
      })();
    },
    [loadArchivedChats, t]
  );

  const archiveAllChats = React.useCallback(() => {
    setArchiveActionId('archive-all');
    setArchivedChatsError(null);
    void (async () => {
      try {
        await archiveAllConversations();
        if (archivedChatsVisible) {
          await loadArchivedChats();
        }
      } catch (error) {
        logger.error('Failed to archive all chats', { error });
        setArchivedChatsError(t('mobile.settings.archiveAllChatsFailed', {
          defaultValue: 'Failed to archive all chats.',
        }));
      } finally {
        setArchiveActionId(null);
      }
    })();
  }, [archivedChatsVisible, loadArchivedChats, t]);

  const deleteAllChats = React.useCallback(() => {
    Alert.alert(
      t('mobile.settings.deleteAllChats', { defaultValue: 'Delete all chats' }),
      t('mobile.settings.deleteAllChatsConfirm', {
        defaultValue: 'Permanently delete all chats? This cannot be undone.',
      }),
      [
        { text: t('mobile.common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('mobile.settings.deleteAll', { defaultValue: 'Delete all' }),
          style: 'destructive',
          onPress: () => {
            setArchiveActionId('delete-all');
            setArchivedChatsError(null);
            void (async () => {
              try {
                await deleteAllConversations();
                setArchivedChats([]);
              } catch (error) {
                logger.error('Failed to delete all chats', { error });
                setArchivedChatsError(t('mobile.settings.deleteAllChatsFailed', {
                  defaultValue: 'Failed to delete all chats.',
                }));
              } finally {
                setArchiveActionId(null);
              }
            })();
          },
        },
      ]
    );
  }, [t]);

  const filteredArchivedChats = React.useMemo(() => {
    const query = archivedSearchQuery.trim().toLowerCase();
    if (!query) {
      return archivedChats;
    }
    return archivedChats.filter((conversation) => {
      const title = conversation.title || t('mobile.settings.untitledChat', 'Untitled chat');
      return `${title} ${conversation.lastMessagePreview ?? ''}`.toLowerCase().includes(query);
    });
  }, [archivedChats, archivedSearchQuery, t]);

  return (
    <Section title={t('mobile.settings.syncSection')}>
      <SettingRow
        label={t('mobile.settings.autoSync')}
        description={t('mobile.settings.autoSyncDescription')}
      />

      <InfoBox label={t('mobile.settings.lastSync')}>
        {syncState.lastSyncTime > 0
          ? new Date(syncState.lastSyncTime).toLocaleString()
          : t('mobile.settings.never')}
      </InfoBox>

      {syncState.lastStats && (
        <View
          className="px-md py-md rounded-2xl border border-white/10 bg-white/5"
          accessible
          accessibilityLabel="Sync statistics"
        >
          <Text className="text-text text-sm font-semibold">{t('mobile.settings.lastRun')}</Text>
          <Text className="text-text-muted text-sm">
            {t('mobile.settings.syncSummary', {
              pushed: syncState.lastStats.pushed.conversations,
              pulled: syncState.lastStats.pulled.conversations,
            })}
          </Text>
          <Text className="text-text-muted text-sm">
            {t('mobile.settings.messageSyncSummary', {
              pushed: syncState.lastStats.pushed.messages,
              pulled: syncState.lastStats.pulled.messages,
            })}
          </Text>
        </View>
      )}

      <SettingRow label={t('mobile.settings.archivedChats', { defaultValue: 'Archived chats' })}>
        <RowButton
          label={t('mobile.settings.manage', { defaultValue: 'Manage' })}
          onPress={openArchivedChats}
        />
      </SettingRow>

      <SettingRow label={t('mobile.settings.archiveAllChats', { defaultValue: 'Archive all chats' })}>
        <RowButton
          label={t('mobile.settings.archiveAll', { defaultValue: 'Archive all' })}
          onPress={archiveAllChats}
          disabled={archiveActionId === 'archive-all'}
        />
      </SettingRow>

      <SettingRow label={t('mobile.settings.deleteAllChats', { defaultValue: 'Delete all chats' })}>
        <RowButton
          label={t('mobile.settings.deleteAll', { defaultValue: 'Delete all' })}
          onPress={deleteAllChats}
          destructive
          disabled={archiveActionId === 'delete-all'}
        />
      </SettingRow>

      <ActionButton
        size="large"
        style={{ marginHorizontal: 16, marginVertical: 10 }}
        className="mb-0"
        onPress={() => {
          void onForceSync();
        }}
        accessibilityLabel={t('mobile.settings.forceSync')}
        accessibilityRole="button"
        accessibilityHint="Triggers an immediate synchronization with the server"
      >
        {t('mobile.settings.forceSync')}
      </ActionButton>

      <ActionButton
        size="large"
        style={{ marginHorizontal: 16, marginVertical: 10 }}
        className="mb-0"
        variant="danger"
        onPress={onClearCache}
        accessibilityLabel={t('mobile.settings.clearCache')}
        accessibilityRole="button"
        accessibilityHint="Deletes all local chat history and resets the app state"
      >
        {t('mobile.settings.clearCache')}
      </ActionButton>

      {isAdmin && (
        <ActionButton
          size="large"
          style={{ marginHorizontal: 16, marginVertical: 10 }}
          className="mb-0"
          variant="danger"
          onPress={onResetDatabase}
          accessibilityLabel="Reset Database"
          accessibilityRole="button"
        >
          Reset Database
        </ActionButton>
      )}

      <ArchivedChatsModal
        visible={archivedChatsVisible}
        conversations={filteredArchivedChats}
        loading={archivedChatsLoading}
        error={archivedChatsError}
        searchQuery={archivedSearchQuery}
        actionId={archiveActionId}
        theme={theme}
        onClose={() => setArchivedChatsVisible(false)}
        onSearchChange={setArchivedSearchQuery}
        onRestore={restoreArchivedChat}
        onDelete={deleteArchivedChat}
      />
    </Section>
  );
}

function RowButton({
  label,
  onPress,
  destructive = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.rowButton,
        { borderColor: destructive ? theme.colors.error : theme.colors.border },
        disabled && styles.disabled,
      ]}
    >
      {disabled ? (
        <ActivityIndicator size="small" color={destructive ? theme.colors.error : theme.colors.text} />
      ) : (
        <Text style={[styles.rowButtonText, { color: destructive ? theme.colors.error : theme.colors.text }]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function ArchivedChatsModal({
  visible,
  conversations,
  loading,
  error,
  searchQuery,
  actionId,
  theme,
  onClose,
  onSearchChange,
  onRestore,
  onDelete,
}: {
  visible: boolean;
  conversations: ArchivedConversation[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  actionId: string | null;
  theme: ReturnType<typeof useTheme>['theme'];
  onClose: () => void;
  onSearchChange: (query: string) => void;
  onRestore: (conversationId: string) => void;
  onDelete: (conversationId: string) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const openActions = React.useCallback(
    (conversation: ArchivedConversation) => {
      const title = conversation.title || t('mobile.settings.untitledChat', 'Untitled chat');
      Alert.alert(title, undefined, [
        {
          text: t('mobile.settings.restoreChat', { defaultValue: 'Restore' }),
          onPress: () => onRestore(conversation.conversationId),
        },
        {
          text: t('mobile.settings.deleteChat', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: () => onDelete(conversation.conversationId),
        },
        { text: t('mobile.common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
      ]);
    },
    [onDelete, onRestore, t]
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          styles.archivedModal,
          {
            backgroundColor: theme.colors.background,
            paddingTop: insets.top,
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        <View style={styles.archivedHeader}>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('mobile.settings.back', { defaultValue: 'Back' })}
            style={[styles.backButton, { borderColor: theme.colors.border }]}
          >
            <Icon name="ChevronLeft" size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={[styles.archivedTitle, { color: theme.colors.text }]}>
            {t('mobile.settings.archivedChats', { defaultValue: 'Archived chats' })}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        {error ? <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text> : null}

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={theme.colors.text} />
          </View>
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.conversationId}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.archivedListContent,
              conversations.length === 0 && styles.archivedEmptyContent,
            ]}
            ListEmptyComponent={
              <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
                {searchQuery.trim()
                  ? t('mobile.settings.noArchivedChatsFound', { defaultValue: 'No archived chats found' })
                  : t('mobile.settings.noArchivedChats', { defaultValue: 'No archived chats' })}
              </Text>
            }
            renderItem={({ item, index }) => {
              const showMonthLabel =
                index === 0 ||
                getMonthGroupLabel(item.createdAt) !== getMonthGroupLabel(conversations[index - 1]?.createdAt);
              const title = item.title || t('mobile.settings.untitledChat', 'Untitled chat');
              const restoreLoading = actionId === `restore:${item.conversationId}`;
              const deleteLoading = actionId === `delete:${item.conversationId}`;
              return (
                <View>
                  {showMonthLabel ? (
                    <Text style={[styles.groupLabel, { color: theme.colors.textMuted }]}>
                      {getMonthGroupLabel(item.createdAt)}
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => openActions(item)}
                    onLongPress={() => openActions(item)}
                    accessibilityRole="button"
                    accessibilityLabel={title}
                    accessibilityHint="Open actions to restore or delete this archived chat"
                    activeOpacity={0.65}
                    style={styles.archivedRow}
                  >
                    <Text numberOfLines={2} style={[styles.archivedRowTitle, { color: theme.colors.text }]}>
                      {title}
                    </Text>
                    {restoreLoading || deleteLoading ? (
                      <ActivityIndicator size="small" color={theme.colors.textMuted} />
                    ) : null}
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        )}

        <View style={[styles.searchBar, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
          <Icon name="Search" size={17} color={theme.colors.textMuted} />
          <TextInput
            value={searchQuery}
            onChangeText={onSearchChange}
            placeholder={t('mobile.settings.searchArchivedChats', { defaultValue: 'Search' })}
            placeholderTextColor={theme.colors.textMuted}
            style={[styles.searchInput, { color: theme.colors.text }]}
            returnKeyType="search"
          />
        </View>
      </View>
    </Modal>
  );
}

function getMonthGroupLabel(timestamp?: number): string {
  if (!timestamp) {
    return 'Earlier';
  }
  const date = new Date(timestamp);
  const now = new Date();
  const months =
    (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  if (months <= 0) {
    return 'This month';
  }
  if (months === 1) {
    return '1 month ago';
  }
  return `${months} months ago`;
}

const styles = StyleSheet.create({
  rowButton: {
    minWidth: 92,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
  },
  rowButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.6,
  },
  archivedModal: {
    flex: 1,
  },
  archivedHeader: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    paddingHorizontal: 14,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archivedTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  headerSpacer: {
    width: 38,
  },
  archivedListContent: {
    paddingHorizontal: 12,
    paddingBottom: 82,
  },
  archivedEmptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 15,
  },
  errorText: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    fontSize: 14,
    textAlign: 'center',
  },
  groupLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 18,
    marginBottom: 8,
  },
  archivedRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  archivedRowTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  searchBar: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 12,
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
  },
});
