import React from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { useSync } from "../../../contexts/SyncContext";
import { useTheme } from "../../../contexts/ThemeContext";
import { ActionButton } from "../../../components/ActionButton";
import { Section, InfoBox, SettingRow } from "../components";
import {
  archiveAllConversations,
  clearConversation,
  deleteAllConversations,
  listArchivedConversations,
  restoreConversation,
} from "../../../storage/chat-local-mobile";
import { createModuleLogger } from "../../../logger";
import {
  ArchivedChatsModal,
  type ArchivedConversation,
} from "./ArchivedChatsModal";

const logger = createModuleLogger("DataControlsSection");

type ArchivedConversationSearchEntry = {
  conversation: ArchivedConversation;
  searchable: string;
};

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
  const [archivedChatsVisible, setArchivedChatsVisible] = React.useState(false);
  const [archivedChats, setArchivedChats] = React.useState<
    ArchivedConversation[]
  >([]);
  const [archivedChatsLoading, setArchivedChatsLoading] = React.useState(false);
  const [archivedChatsError, setArchivedChatsError] = React.useState<
    string | null
  >(null);
  const [archivedSearchQuery, setArchivedSearchQuery] = React.useState("");
  const [archiveActionId, setArchiveActionId] = React.useState<string | null>(
    null,
  );

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
      logger.error("Failed to load archived chats", { error });
      setArchivedChatsError(
        t("mobile.settings.archivedChatsLoadFailed", {
          defaultValue: "Failed to load archived chats.",
        }),
      );
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
          logger.error("Failed to restore archived chat", {
            conversationId,
            error,
          });
          setArchivedChatsError(
            t("mobile.settings.restoreArchivedChatFailed", {
              defaultValue: "Failed to restore archived chat.",
            }),
          );
        } finally {
          setArchiveActionId(null);
        }
      })();
    },
    [loadArchivedChats, t],
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
          logger.error("Failed to delete archived chat", {
            conversationId,
            error,
          });
          setArchivedChatsError(
            t("mobile.settings.deleteArchivedChatFailed", {
              defaultValue: "Failed to delete archived chat.",
            }),
          );
        } finally {
          setArchiveActionId(null);
        }
      })();
    },
    [loadArchivedChats, t],
  );

  const archiveAllChats = React.useCallback(() => {
    setArchiveActionId("archive-all");
    setArchivedChatsError(null);
    void (async () => {
      try {
        await archiveAllConversations();
        if (archivedChatsVisible) {
          await loadArchivedChats();
        }
      } catch (error) {
        logger.error("Failed to archive all chats", { error });
        setArchivedChatsError(
          t("mobile.settings.archiveAllChatsFailed", {
            defaultValue: "Failed to archive all chats.",
          }),
        );
      } finally {
        setArchiveActionId(null);
      }
    })();
  }, [archivedChatsVisible, loadArchivedChats, t]);

  const deleteAllChats = React.useCallback(() => {
    Alert.alert(
      t("mobile.settings.deleteAllChats", { defaultValue: "Delete all chats" }),
      t("mobile.settings.deleteAllChatsConfirm", {
        defaultValue: "Permanently delete all chats? This cannot be undone.",
      }),
      [
        {
          text: t("mobile.common.cancel", { defaultValue: "Cancel" }),
          style: "cancel",
        },
        {
          text: t("mobile.settings.deleteAll", { defaultValue: "Delete all" }),
          style: "destructive",
          onPress: () => {
            setArchiveActionId("delete-all");
            setArchivedChatsError(null);
            void (async () => {
              try {
                await deleteAllConversations();
                setArchivedChats([]);
              } catch (error) {
                logger.error("Failed to delete all chats", { error });
                setArchivedChatsError(
                  t("mobile.settings.deleteAllChatsFailed", {
                    defaultValue: "Failed to delete all chats.",
                  }),
                );
              } finally {
                setArchiveActionId(null);
              }
            })();
          },
        },
      ],
    );
  }, [t]);

  const archivedChatSearchEntries = React.useMemo<ArchivedConversationSearchEntry[]>(
    () =>
      archivedChats.map((conversation) => {
        const title =
          conversation.title ||
          t("mobile.settings.untitledChat", "Untitled chat");
        return {
          conversation,
          searchable: `${title} ${conversation.lastMessagePreview ?? ""}`.toLowerCase(),
        };
      }),
    [archivedChats, t],
  );

  const filteredArchivedChats = React.useMemo(() => {
    const query = archivedSearchQuery.trim().toLowerCase();
    if (!query) {
      return archivedChats;
    }
    const filtered: ArchivedConversation[] = [];
    for (let index = 0; index < archivedChatSearchEntries.length; index++) {
      const entry = archivedChatSearchEntries[index];
      if (entry.searchable.includes(query)) {
        filtered.push(entry.conversation);
      }
    }
    return filtered;
  }, [archivedChatSearchEntries, archivedChats, archivedSearchQuery]);

  return (
    <Section title={t("mobile.settings.syncSection")}>
      <SettingRow
        label={t("mobile.settings.autoSync")}
        description={t("mobile.settings.autoSyncDescription")}
      />

      <InfoBox label={t("mobile.settings.lastSync")}>
        {syncState.lastSyncTime > 0
          ? new Date(syncState.lastSyncTime).toLocaleString()
          : t("mobile.settings.never")}
      </InfoBox>

      {syncState.lastStats && (
        <View
          className="px-md py-md rounded-2xl border border-white/10 bg-white/5"
          accessible
          accessibilityLabel="Sync statistics"
        >
          <Text className="text-text text-sm font-semibold">
            {t("mobile.settings.lastRun")}
          </Text>
          <Text className="text-text-muted text-sm">
            {t("mobile.settings.syncSummary", {
              pushed: syncState.lastStats.pushed.conversations,
              pulled: syncState.lastStats.pulled.conversations,
            })}
          </Text>
          <Text className="text-text-muted text-sm">
            {t("mobile.settings.messageSyncSummary", {
              pushed: syncState.lastStats.pushed.messages,
              pulled: syncState.lastStats.pulled.messages,
            })}
          </Text>
        </View>
      )}

      <SettingRow
        label={t("mobile.settings.archivedChats", {
          defaultValue: "Archived chats",
        })}
      >
        <RowButton
          label={t("mobile.settings.manage", { defaultValue: "Manage" })}
          onPress={openArchivedChats}
        />
      </SettingRow>

      <SettingRow
        label={t("mobile.settings.archiveAllChats", {
          defaultValue: "Archive all chats",
        })}
      >
        <RowButton
          label={t("mobile.settings.archiveAll", {
            defaultValue: "Archive all",
          })}
          onPress={archiveAllChats}
          disabled={archiveActionId === "archive-all"}
        />
      </SettingRow>

      <SettingRow
        label={t("mobile.settings.deleteAllChats", {
          defaultValue: "Delete all chats",
        })}
      >
        <RowButton
          label={t("mobile.settings.deleteAll", { defaultValue: "Delete all" })}
          onPress={deleteAllChats}
          destructive
          disabled={archiveActionId === "delete-all"}
        />
      </SettingRow>

      <ActionButton
        size="large"
        style={{ marginHorizontal: 16, marginVertical: 10 }}
        className="mb-0"
        onPress={() => {
          void onForceSync();
        }}
        accessibilityLabel={t("mobile.settings.forceSync")}
        accessibilityRole="button"
        accessibilityHint="Triggers an immediate synchronization with the server"
      >
        {t("mobile.settings.forceSync")}
      </ActionButton>

      <ActionButton
        size="large"
        style={{ marginHorizontal: 16, marginVertical: 10 }}
        className="mb-0"
        variant="danger"
        onPress={onClearCache}
        accessibilityLabel={t("mobile.settings.clearCache")}
        accessibilityRole="button"
        accessibilityHint="Deletes all local chat history and resets the app state"
      >
        {t("mobile.settings.clearCache")}
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
        <ActivityIndicator
          size="small"
          color={destructive ? theme.colors.error : theme.colors.text}
        />
      ) : (
        <Text
          style={[
            styles.rowButtonText,
            { color: destructive ? theme.colors.error : theme.colors.text },
          ]}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  rowButton: {
    minWidth: 92,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
  },
  rowButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.6,
  },
});
