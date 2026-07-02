/**
 * Sources List - Display source citations
 */
import { spacingTokens } from '@taskforceai/design-tokens';
import { Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import type { SourceReference } from '../types';
import { createModuleLogger } from '../logger';
import { Icon } from './Icon';
import {
  extractDomain,
  sanitizeRenderableSources,
} from '@taskforceai/shared/utils/source-extraction';

interface SourcesListProps {
  sources: SourceReference[];
}

const logger = createModuleLogger('SourcesList');

export function SourcesList({ sources }: SourcesListProps) {
  const sanitizedSources = sanitizeRenderableSources({
    logger,
    loggerContext: 'SourcesList',
    sources,
  });

  if (sanitizedSources.length === 0) {
    return null;
  }

  const handleSourcePress = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        logger.error('Cannot open URL', { url });
      }
    } catch (error) {
      logger.error('Failed to open URL', { error, url });
    }
  };

  return (
    <View className="mt-sm pt-sm border-t border-border">
      <Text className="mb-sm text-text text-xs font-semibold">Sources ({sanitizedSources.length})</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: spacingTokens.md }}
      >
        {sanitizedSources.map((source, index) => (
          <TouchableOpacity
            key={index}
            className="mr-md px-md py-md w-[240px] rounded-2xl border border-border"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}
            onPress={() => {
              void handleSourcePress(source.safeUrl);
            }}
            activeOpacity={0.7}
          >
            <Text className="mb-xs text-[11px] font-semibold tracking-wide text-primary uppercase">
              {extractDomain(source.safeUrl)}
            </Text>
            {source.title && (
              <Text className="mb-sm text-text text-sm leading-5 font-semibold" numberOfLines={2}>
                {source.title}
              </Text>
            )}
            {source.snippet && (
              <Text className="mb-sm text-text-muted text-xs leading-4" numberOfLines={2}>
                {source.snippet}
              </Text>
            )}
            <View className="pt-sm border-t border-border">
              <View className="gap-xs flex-row items-center">
                <Text className="text-xs font-semibold text-primary">View source</Text>
                <Icon name="ArrowUpRight" size={14} color="#60a5fa" />
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}
