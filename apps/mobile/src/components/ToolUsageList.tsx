import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { buildToolUsageViewItems } from '@taskforceai/presenters/tool-usage/view-model';

import type { ToolUsageEvent } from '../types';
import { CodeContent, GenericContent, SearchContent } from './ToolUsageList.content';
import { styles } from './ToolUsageList.styles';

interface ToolUsageListProps {
  toolEvents: ToolUsageEvent[];
  variant?: 'default' | 'embedded';
}

export function ToolUsageList({ toolEvents, variant = 'default' }: ToolUsageListProps) {
  const enrichedEvents = useMemo(() => buildToolUsageViewItems(toolEvents), [toolEvents]);

  if (!enrichedEvents || enrichedEvents.length === 0) {
    return null;
  }

  const isEmbedded = variant === 'embedded';

  return (
    <View
      style={[styles.container, isEmbedded ? styles.embeddedContainer : styles.defaultContainer]}
    >
      {!isEmbedded && <Text style={styles.heading}>Tool Usage ({toolEvents.length})</Text>}
      <View style={styles.cardStack}>
        {enrichedEvents.map(({ event, key, title, status, durationLabel, isSearch, isCode, searchPreview, codeArgs, codePreview }) => {
          return (
            <View key={key} style={[styles.card, isEmbedded && styles.embeddedCard]}>
              <View style={styles.cardHeader}>
                <Text style={styles.toolTitle}>{title}</Text>
                <View style={[styles.statusPill, { backgroundColor: status.color }]}>
                  <Text style={styles.statusText}>{status.label}</Text>
                </View>
              </View>
              <View style={styles.metaRow}>
                {event.agentLabel && <Text style={styles.metaText}>{event.agentLabel}</Text>}
                {durationLabel && <Text style={styles.metaText}>{durationLabel}</Text>}
              </View>

              {isSearch && <SearchContent preview={searchPreview} />}
              {isCode && <CodeContent codeArgs={codeArgs} codePreview={codePreview} />}
              {!isSearch && !isCode && <GenericContent event={event} />}

              {event.error && <Text style={styles.errorText}>{event.error}</Text>}
            </View>
          );
        })}
      </View>
    </View>
  );
}
