import type { Memory } from '@taskforceai/contracts';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { useTheme } from '../../contexts/ThemeContext';

interface MemorySummaryModalProps {
  visible: boolean;
  memories: Memory[];
  loading: boolean;
  saving: boolean;
  deletingId: number | null;
  editingMemoryId: number | null;
  draft: string;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  onEdit: (memory: Memory) => void;
  onDelete: (memory: Memory) => Promise<void>;
  onCancelEdit: () => void;
}

const formatUpdatedLabel = (updatedAt: string | null, fallback: string) => {
  if (!updatedAt) return fallback;

  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return fallback;

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export function MemorySummaryModal({
  visible,
  memories,
  loading,
  saving,
  deletingId,
  editingMemoryId,
  draft,
  error,
  onClose,
  onRetry,
  onDraftChange,
  onSubmit,
  onEdit,
  onDelete,
  onCancelEdit,
}: MemorySummaryModalProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const latestUpdatedAt = memories[0]?.updated_at ?? null;
  const canSubmit = draft.trim().length > 0 && !saving;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.headerButton, { backgroundColor: theme.colors.cardBackground }]}
            accessibilityRole="button"
            accessibilityLabel={t('mobile.settings.memorySummaryBack', { defaultValue: 'Back' })}
          >
            <Icon name="ChevronLeft" size={20} color={theme.colors.text} />
          </TouchableOpacity>

          <View style={styles.headerTitleGroup}>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
              {t('mobile.settings.memorySummaryTitle', { defaultValue: 'Memory summary' })}
            </Text>
            <Text style={[styles.headerSubtitle, { color: theme.colors.textMuted }]}>
              {latestUpdatedAt
                ? t('mobile.settings.memoryUpdatedAt', {
                    defaultValue: 'Updated {{time}}',
                    time: formatUpdatedLabel(latestUpdatedAt, ''),
                  })
                : t('mobile.settings.memoryNoUpdates', { defaultValue: 'No memories yet' })}
            </Text>
          </View>

          <View style={styles.headerButtonPlaceholder} />
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={[styles.centerText, { color: theme.colors.textMuted }]}>
                {t('mobile.settings.memoryLoading', { defaultValue: 'Loading memory summary...' })}
              </Text>
            </View>
          ) : error ? (
            <View style={styles.centerState}>
              <Text style={[styles.centerTitle, { color: theme.colors.text }]}>
                {t('mobile.settings.memoryLoadErrorTitle', { defaultValue: 'Could not load memories' })}
              </Text>
              <Text style={[styles.centerText, { color: theme.colors.textMuted }]}>{error}</Text>
              <TouchableOpacity
                onPress={onRetry}
                style={[styles.retryButton, { borderColor: theme.colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={t('mobile.settings.memoryRetry', { defaultValue: 'Retry' })}
              >
                <Text style={[styles.retryButtonText, { color: theme.colors.text }]}>
                  {t('mobile.settings.memoryRetry', { defaultValue: 'Retry' })}
                </Text>
              </TouchableOpacity>
            </View>
          ) : memories.length === 0 ? (
            <View style={styles.centerState}>
              <Text style={[styles.centerTitle, { color: theme.colors.text }]}>
                {t('mobile.settings.memoryEmptyTitle', { defaultValue: 'No saved memories' })}
              </Text>
              <Text style={[styles.centerText, { color: theme.colors.textMuted }]}>
                {t('mobile.settings.memoryEmptyDescription', {
                  defaultValue: 'Add details TaskForceAI should remember across chats.',
                })}
              </Text>
            </View>
          ) : (
            memories.map((memory) => {
              const isDeleting = deletingId === memory.id;
              const isEditing = editingMemoryId === memory.id;
              return (
                <View
                  key={memory.id}
                  style={[
                    styles.memoryCard,
                    {
                      backgroundColor: theme.colors.cardBackground,
                      borderColor: isEditing ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text selectable style={[styles.memoryText, { color: theme.colors.text }]}>
                    {memory.content}
                  </Text>
                  <View style={styles.memoryMetaRow}>
                    <Text style={[styles.memoryMeta, { color: theme.colors.textMuted }]}>
                      {memory.type} · {formatUpdatedLabel(memory.updated_at, '')}
                    </Text>
                    <View style={styles.memoryActions}>
                      <TouchableOpacity
                        onPress={() => onEdit(memory)}
                        accessibilityRole="button"
                        accessibilityLabel={t('mobile.settings.memoryEdit', { defaultValue: 'Edit memory' })}
                        disabled={saving || isDeleting}
                      >
                        <Text style={[styles.memoryActionText, { color: theme.colors.primary }]}>
                          {t('mobile.settings.memoryEditShort', { defaultValue: 'Edit' })}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => void onDelete(memory)}
                        accessibilityRole="button"
                        accessibilityLabel={t('mobile.settings.memoryDelete', { defaultValue: 'Delete memory' })}
                        disabled={saving || isDeleting}
                      >
                        <Text style={[styles.memoryActionText, { color: theme.colors.error }]}>
                          {isDeleting
                            ? t('mobile.settings.memoryDeleting', { defaultValue: 'Deleting' })
                            : t('mobile.settings.memoryDeleteShort', { defaultValue: 'Delete' })}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        <View style={[styles.composerWrap, { borderTopColor: theme.colors.border }]}>
          {editingMemoryId ? (
            <View style={styles.editingRow}>
              <Text style={[styles.editingText, { color: theme.colors.textMuted }]}>
                {t('mobile.settings.memoryEditing', { defaultValue: 'Editing memory' })}
              </Text>
              <TouchableOpacity onPress={onCancelEdit} accessibilityRole="button">
                <Text style={[styles.cancelEditText, { color: theme.colors.primary }]}>
                  {t('mobile.settings.memoryCancelEdit', { defaultValue: 'Cancel' })}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={[styles.composer, { backgroundColor: theme.colors.inputBackground }]}>
            <TextInput
              value={draft}
              onChangeText={onDraftChange}
              placeholder={t('mobile.settings.memoryComposerPlaceholder', { defaultValue: 'Add or update' })}
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.composerInput, { color: theme.colors.text }]}
              multiline
              editable={!saving}
              accessibilityLabel={t('mobile.settings.memoryComposerPlaceholder', { defaultValue: 'Add or update' })}
            />
            <TouchableOpacity
              onPress={() => void onSubmit()}
              disabled={!canSubmit}
              style={[
                styles.sendButton,
                { backgroundColor: canSubmit ? theme.colors.primary : theme.colors.border },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('mobile.settings.memorySubmit', { defaultValue: 'Save memory' })}
            >
              {saving ? (
                <ActivityIndicator color={theme.colors.white} size="small" />
              ) : (
                <Icon name="Send" size={18} color={theme.colors.white} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  headerButtonPlaceholder: {
    width: 36,
  },
  headerTitleGroup: {
    alignItems: 'center',
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 24,
  },
  centerState: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 56,
  },
  centerTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  centerText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  memoryCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    padding: 14,
  },
  memoryText: {
    fontSize: 15,
    lineHeight: 21,
  },
  memoryMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 12,
  },
  memoryMeta: {
    flex: 1,
    fontSize: 12,
  },
  memoryActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  memoryActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  composerWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  editingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  editingText: {
    fontSize: 13,
  },
  cancelEditText: {
    fontSize: 13,
    fontWeight: '700',
  },
  composer: {
    alignItems: 'flex-end',
    borderRadius: 24,
    flexDirection: 'row',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  composerInput: {
    flex: 1,
    fontSize: 16,
    maxHeight: 110,
    minHeight: 36,
    paddingTop: 8,
  },
  sendButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
});
