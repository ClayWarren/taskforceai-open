import React from 'react';
import { Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../../contexts/ThemeContext';
import {
  threadItemImageUri,
  threadItemText,
  type DesktopThread,
  type DesktopThreadItem,
} from '../../hooks/api/desktopWork';
import { Icon } from '../Icon';
import { RemoteStatusText } from './RemoteControls';

export function RemoteThreadActivity({ thread, loading }: { thread: DesktopThread; loading: boolean }) {
  const items = thread.turns.flatMap((turn) => turn.items);
  if (loading && items.length === 0) return <RemoteStatusText text="Loading remote activity…" />;
  if (items.length === 0) return <RemoteStatusText text="No activity has been recorded yet." />;
  if (thread.taskMode === 'chat') return <RemoteChatTranscript items={items} />;
  return (
    <View style={{ gap: 8 }}>
      {groupThreadItems(items).map((entry) =>
        entry.kind === 'tools' ? (
          <RemoteToolGroup key={entry.id} items={entry.items} />
        ) : (
          <RemoteActivityItem key={entry.item.id} item={entry.item} />
        )
      )}
    </View>
  );
}

function RemoteChatTranscript({ items }: { items: DesktopThreadItem[] }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 14 }}>
      {items.map((item) => {
        const fromUser = item.type === 'userMessage' || item.type === 'steeringMessage';
        const text = threadItemText(item);
        const imageUri = threadItemImageUri(item);
        if (!text && !imageUri) return null;
        return (
          <View
            key={item.id}
            style={{
              alignSelf: fromUser ? 'flex-end' : 'stretch',
              maxWidth: fromUser ? '86%' : '100%',
              gap: 7,
              paddingHorizontal: fromUser ? 14 : 0,
              paddingVertical: fromUser ? 10 : 2,
              borderRadius: fromUser ? 18 : 0,
              borderCurve: 'continuous',
              backgroundColor: fromUser ? theme.colors.cardBackground : 'transparent',
            }}
          >
            {text ? (
              <Text selectable style={{ color: item.type === 'error' ? '#fca5a5' : theme.colors.text, fontSize: 16, lineHeight: 23 }}>
                {text}
              </Text>
            ) : null}
            {imageUri ? (
              <Image accessibilityLabel="Remote desktop screenshot" source={{ uri: imageUri }} resizeMode="contain" style={{ width: '100%', aspectRatio: 16 / 10, borderRadius: 12 }} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function RemoteToolGroup({ items }: { items: DesktopThreadItem[] }) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = React.useState(false);
  const summary = toolGroupSummary(items);
  return (
    <View style={{ gap: 7 }}>
      <TouchableActivityRow
        label={summary}
        expanded={expanded}
        onPress={() => setExpanded((current) => !current)}
      />
      {expanded ? (
        <View style={{ gap: 7, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: theme.colors.border }}>
          {items.map((item) => <RemoteActivityItem key={item.id} item={item} compact />)}
        </View>
      ) : null}
    </View>
  );
}

function TouchableActivityRow({ label, expanded, onPress }: { label: string; expanded: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}
    >
      <Icon name="Zap" size={15} color={theme.colors.textMuted} />
      <Text style={{ flex: 1, color: theme.colors.textMuted, fontSize: 14 }}>{label}</Text>
      <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={14} color={theme.colors.textMuted} />
    </TouchableOpacity>
  );
}

function RemoteActivityItem({ item, compact = false }: { item: DesktopThreadItem; compact?: boolean }) {
  const { theme } = useTheme();
  const text = threadItemText(item);
  const imageUri = threadItemImageUri(item);
  const diff = threadItemDiff(item);
  return (
    <View style={{ gap: 7, padding: compact ? 9 : 12, borderRadius: 14, borderCurve: 'continuous', backgroundColor: theme.colors.cardBackground }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name={activityIcon(item)} size={14} color={theme.colors.textMuted} />
        <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' }}>{diff ? 'Diff' : activityLabel(item)}</Text>
        {diff ? <Icon name="Copy" size={14} color={theme.colors.textMuted} /> : null}
        <Text style={{ marginLeft: 'auto', color: statusColor(item.status), fontSize: 10 }}>{formatStatus(item.status)}</Text>
      </View>
      {diff ? <RemoteInlineDiff diff={diff} /> : text ? (
        <Text selectable style={{ color: theme.colors.text, lineHeight: 19 }}>{text}</Text>
      ) : null}
      {imageUri ? (
        <Image
          accessibilityLabel="Remote desktop screenshot"
          source={{ uri: imageUri }}
          resizeMode="contain"
          style={{ width: '100%', aspectRatio: 16 / 10, borderRadius: 10 }}
        />
      ) : null}
    </View>
  );
}

type ActivityEntry =
  | { kind: 'item'; item: DesktopThreadItem }
  | { kind: 'tools'; id: string; items: DesktopThreadItem[] };

const groupThreadItems = (items: DesktopThreadItem[]): ActivityEntry[] => {
  const entries: ActivityEntry[] = [];
  for (const item of items) {
    const previous = entries.at(-1);
    if (item.type === 'toolCall' && previous?.kind === 'tools') {
      previous.items.push(item);
    } else if (item.type === 'toolCall') {
      entries.push({ kind: 'tools', id: `tools:${item.turnId}:${item.id}`, items: [item] });
    } else {
      entries.push({ kind: 'item', item });
    }
  }
  return entries;
};

const toolGroupSummary = (items: DesktopThreadItem[]) => {
  const names = items.map(toolName).filter(Boolean);
  const edited = names.filter((name) => /edit|write|patch|create|delete/i.test(name)).length;
  const explored = names.filter((name) => /read|search|find|list|glob|grep/i.test(name)).length;
  const ran = names.filter((name) => /exec|command|shell|terminal|test/i.test(name)).length;
  const parts = [
    edited ? `edited ${edited} ${edited === 1 ? 'file' : 'files'}` : '',
    explored ? `explored ${explored} ${explored === 1 ? 'item' : 'items'}` : '',
    ran ? `ran ${ran} ${ran === 1 ? 'command' : 'commands'}` : '',
  ].filter(Boolean);
  if (parts.length === 0) return `Used ${items.length} desktop ${items.length === 1 ? 'tool' : 'tools'}`;
  return parts.join(', ').replace(/^./, (value) => value.toUpperCase());
};

const toolName = (item: DesktopThreadItem) => {
  if (!item.content || typeof item.content !== 'object' || Array.isArray(item.content)) return '';
  const content = item.content as Record<string, unknown>;
  const value = content.toolName ?? content.name;
  return typeof value === 'string' ? value : '';
};

function RemoteInlineDiff({ diff }: { diff: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View accessibilityLabel="Remote inline diff" style={{ minWidth: '100%', paddingVertical: 4 }}>
        {diff.split('\n').map((line, index) => (
          <Text
            key={`${index}:${line}`}
            selectable
            style={{
              color: diffLineColor(line),
              fontFamily: 'monospace',
              fontSize: 11,
              lineHeight: 17,
            }}
          >
            {line || ' '}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const threadItemDiff = (item: DesktopThreadItem): string | null => {
  if (!item.content || typeof item.content !== 'object' || Array.isArray(item.content)) return null;
  const content = item.content as Record<string, unknown>;
  const candidates = [
    content.diff,
    content.rawDiff,
    content.patch,
    nestedString(content.metadata, 'diff'),
    nestedString(content.result, 'diff'),
    nestedString(content.output, 'diff'),
    content.resultPreview,
  ];
  const diff = candidates.find((value) => typeof value === 'string' && looksLikeDiff(value));
  return typeof diff === 'string' ? diff : null;
};

const nestedString = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;

const looksLikeDiff = (value: string) =>
  value.includes('@@ ') || value.split('\n').some((line) => line.startsWith('+++ ') || line.startsWith('--- '));

const diffLineColor = (line: string) => {
  if (line.startsWith('+') && !line.startsWith('+++')) return '#4ade80';
  if (line.startsWith('-') && !line.startsWith('---')) return '#f87171';
  if (line.startsWith('@@')) return '#c084fc';
  return '#d1d5db';
};

const activityIcon = (item: DesktopThreadItem): React.ComponentProps<typeof Icon>['name'] => {
  if (item.type === 'userMessage' || item.type === 'steeringMessage') return 'UserRound';
  if (item.type === 'toolCall') return 'Zap';
  if (item.type === 'approval') return 'ShieldCheck';
  if (item.type === 'error') return 'AlertTriangle';
  return 'Activity';
};
const activityLabel = (item: DesktopThreadItem) => item.type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase());
const formatStatus = (status: string) => status.replace(/([a-z])([A-Z])/g, '$1 $2');
const statusColor = (status: string) => status === 'failed' || status === 'declined' ? '#fca5a5' : status === 'inProgress' ? '#93c5fd' : '#86efac';
