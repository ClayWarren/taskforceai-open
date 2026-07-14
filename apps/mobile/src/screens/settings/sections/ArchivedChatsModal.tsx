import React from "react";
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
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../../../components/Icon";
import { useTheme } from "../../../contexts/ThemeContext";
import type { LocalConversation } from "../../../storage/chat-local-mobile";

export type ArchivedConversation = Pick<
  LocalConversation,
  "conversationId" | "title" | "createdAt" | "updatedAt" | "lastMessagePreview"
>;

interface ArchivedChatsModalProps {
  visible: boolean;
  conversations: ArchivedConversation[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  actionId: string | null;
  onClose: () => void;
  onSearchChange: (query: string) => void;
  onRestore: (conversationId: string) => void;
  onDelete: (conversationId: string) => void;
}

export function ArchivedChatsModal({
  visible,
  conversations,
  loading,
  error,
  searchQuery,
  actionId,
  onClose,
  onSearchChange,
  onRestore,
  onDelete,
}: ArchivedChatsModalProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const openActions = React.useCallback(
    (conversation: ArchivedConversation) => {
      const title =
        conversation.title ||
        t("mobile.settings.untitledChat", "Untitled chat");
      Alert.alert(title, undefined, [
        {
          text: t("mobile.settings.restoreChat", { defaultValue: "Restore" }),
          onPress: () => onRestore(conversation.conversationId),
        },
        {
          text: t("mobile.settings.deleteChat", { defaultValue: "Delete" }),
          style: "destructive",
          onPress: () => onDelete(conversation.conversationId),
        },
        {
          text: t("mobile.common.cancel", { defaultValue: "Cancel" }),
          style: "cancel",
        },
      ]);
    },
    [onDelete, onRestore, t],
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
            accessibilityLabel={t("mobile.settings.back", {
              defaultValue: "Back",
            })}
            style={[styles.backButton, { borderColor: theme.colors.border }]}
          >
            <Icon name="ChevronLeft" size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={[styles.archivedTitle, { color: theme.colors.text }]}>
            {t("mobile.settings.archivedChats", {
              defaultValue: "Archived chats",
            })}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        {error ? (
          <Text style={[styles.errorText, { color: theme.colors.error }]}>
            {error}
          </Text>
        ) : null}

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
              <Text
                style={[styles.emptyText, { color: theme.colors.textMuted }]}
              >
                {searchQuery.trim()
                  ? t("mobile.settings.noArchivedChatsFound", {
                      defaultValue: "No archived chats found",
                    })
                  : t("mobile.settings.noArchivedChats", {
                      defaultValue: "No archived chats",
                    })}
              </Text>
            }
            renderItem={({ item, index }) => {
              const showMonthLabel =
                index === 0 ||
                getMonthGroupLabel(item.createdAt) !==
                  getMonthGroupLabel(conversations[index - 1]?.createdAt);
              const title =
                item.title ||
                t("mobile.settings.untitledChat", "Untitled chat");
              const restoreLoading =
                actionId === `restore:${item.conversationId}`;
              const deleteLoading =
                actionId === `delete:${item.conversationId}`;
              return (
                <View>
                  {showMonthLabel ? (
                    <Text
                      style={[
                        styles.groupLabel,
                        { color: theme.colors.textMuted },
                      ]}
                    >
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
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.archivedRowTitle,
                        { color: theme.colors.text },
                      ]}
                    >
                      {title}
                    </Text>
                    {restoreLoading || deleteLoading ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.colors.textMuted}
                      />
                    ) : null}
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        )}

        <View
          style={[
            styles.searchBar,
            {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          <Icon name="Search" size={17} color={theme.colors.textMuted} />
          <TextInput
            value={searchQuery}
            onChangeText={onSearchChange}
            placeholder={t("mobile.settings.searchArchivedChats", {
              defaultValue: "Search",
            })}
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
    return "Earlier";
  }
  const date = new Date(timestamp);
  const now = new Date();
  const months =
    (now.getFullYear() - date.getFullYear()) * 12 +
    (now.getMonth() - date.getMonth());
  if (months <= 0) {
    return "This month";
  }
  if (months === 1) {
    return "1 month ago";
  }
  return `${months} months ago`;
}

const styles = StyleSheet.create({
  archivedModal: {
    flex: 1,
  },
  archivedHeader: {
    minHeight: 58,
    alignItems: "center",
    justifyContent: "space-between",
    flexDirection: "row",
    paddingHorizontal: 14,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  archivedTitle: {
    fontSize: 17,
    fontWeight: "700",
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
    justifyContent: "center",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    textAlign: "center",
    fontSize: 15,
  },
  errorText: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    fontSize: 14,
    textAlign: "center",
  },
  groupLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 18,
    marginBottom: 8,
  },
  archivedRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  archivedRowTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
  },
  searchBar: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 12,
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
  },
});
