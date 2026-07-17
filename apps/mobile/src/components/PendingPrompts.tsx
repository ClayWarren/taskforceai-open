/**
 * Pending Prompts - Shows queued offline prompts
 */
import { spacingTokens } from '@taskforceai/design-tokens';
import { extractQueuedRunPayloadMetadata } from '@taskforceai/client-runtime';
import {
  pendingPromptStatusColor,
  summarizePendingPrompts,
} from '@taskforceai/presenters/chat/pending-prompts';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import {
  useClearPendingPromptsMutation,
  usePendingPromptsQuery,
  useRemovePendingPromptMutation,
} from '../hooks/api/pendingPrompts';
import { createModuleLogger } from '../logger';
import { Icon } from './Icon';

const logger = createModuleLogger('PendingPrompts');

export function PendingPrompts() {
  const { t } = useTranslation();
  const pendingPromptsQuery = usePendingPromptsQuery();
  const clearMutation = useClearPendingPromptsMutation();
  const removeMutation = useRemovePendingPromptMutation();
  const pendingPrompts = pendingPromptsQuery.data ?? [];

  const handleClearAll = async () => {
    try {
      await clearMutation.mutateAsync();
    } catch (error) {
      logger.error('Failed to clear pending prompts', { error });
    }
  };

  const handleRemove = async (id?: number) => {
    if (typeof id !== 'number') {
      return;
    }
    try {
      await removeMutation.mutateAsync(id);
    } catch (error) {
      logger.error('Failed to remove pending prompt', { error, id });
    }
  };

  if (pendingPrompts.length === 0) {
    return null;
  }

  const summary = summarizePendingPrompts(pendingPrompts);
  const statusColor = pendingPromptStatusColor(summary.primaryStatus);

  return (
    <View className="px-md pb-sm">
      <View
        className="rounded-xl border border-border/70 px-sm py-sm"
        style={{ backgroundColor: 'rgba(10, 14, 28, 0.78)' }}
      >
        <View className="mb-xs flex-row items-center justify-between gap-sm">
          <View className="min-w-0 flex-1 flex-row items-center gap-xs">
            <View
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: statusColor }}
            />
            <Text className="text-text text-xs font-semibold" numberOfLines={1}>
              {summary.savedTitle}
            </Text>
            <Text className="text-text-muted text-[11px]" numberOfLines={1}>
              {summary.statusLabel}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              void handleClearAll();
            }}
            className="h-7 w-7 items-center justify-center rounded-full"
            accessibilityRole="button"
            accessibilityLabel={t('mobile.pendingPrompts.clearAll', 'Clear All')}
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
          >
            <Icon name="Trash2" size={13} color="#cbd5e1" />
          </TouchableOpacity>
        </View>

        <Text className="mb-xs text-text-muted text-[11px]" numberOfLines={1}>
          {summary.failedCount > 0
            ? t(
                'mobile.pendingPrompts.failedHint',
                summary.queuedCount > 0 || summary.pendingCount > 0
                  ? 'Queued prompts retry automatically. Failed prompts stay saved until removed.'
                  : 'Failed prompts stay saved until removed.'
              )
            : t(
                'mobile.pendingPrompts.retryHint',
                'Will retry automatically when the connection is back.'
              )}
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacingTokens.xs }}
        >
          {pendingPrompts.map((prompt) => {
            const { modelId } = extractQueuedRunPayloadMetadata(prompt.runPayload);
            const promptKey = prompt.id ?? `${prompt.prompt}-${prompt.createdAt}`;
            const promptStatusColor = pendingPromptStatusColor(
              prompt.status === 'failed' || prompt.status === 'pending' ? prompt.status : 'queued'
            );
            return (
              <View
                key={promptKey}
                className="max-w-[220px] flex-row items-center gap-xs rounded-full border border-border/60 py-1 pl-2 pr-1"
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}
              >
                <View
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: promptStatusColor }}
                />
                <View className="min-w-0 flex-1">
                  <Text className="text-text text-[11px] font-medium" numberOfLines={1}>
                    {prompt.prompt}
                  </Text>
                  <Text className="text-text-muted text-[10px]" numberOfLines={1}>
                    {modelId ?? new Date(prompt.createdAt).toLocaleTimeString()}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    void handleRemove(prompt.id);
                  }}
                  className="h-6 w-6 items-center justify-center rounded-full"
                  accessibilityRole="button"
                  accessibilityLabel={t('mobile.pendingPrompts.remove', 'Remove prompt')}
                >
                  <Icon name="X" size={12} color="#94a3b8" />
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
