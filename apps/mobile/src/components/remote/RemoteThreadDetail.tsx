import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../../contexts/ThemeContext';
import { useDesktopThreadQuery, type DesktopThread } from '../../hooks/api/desktopWork';
import { RemoteFilesPanel } from './RemoteFilesPanel';
import { RemoteReviewPanel } from './RemoteReviewPanel';
import { RemoteThreadActions } from './RemoteThreadActions';
import { RemoteThreadActivity } from './RemoteThreadActivity';
import { RemoteThreadComposer } from './RemoteThreadComposer';

type DetailTab = 'activity' | 'changes' | 'files';

export function RemoteThreadDetail({
  summary,
  onDeleted,
  onForked,
  hasPendingInteraction = false,
}: {
  summary: DesktopThread;
  onDeleted: () => void;
  onForked: (thread: DesktopThread) => void;
  hasPendingInteraction?: boolean;
}) {
  const { theme } = useTheme();
  const [tab, setTab] = React.useState<DetailTab>('activity');
  const threadQuery = useDesktopThreadQuery(summary.id, true);
  const thread = threadQuery.data ?? summary;
  const detailTabs = React.useMemo<DetailTab[]>(
    () => (thread.taskMode === 'code' ? ['activity', 'changes', 'files'] : ['activity']),
    [thread.taskMode]
  );
  const needsInput =
    hasPendingInteraction ||
    thread.turns.some((turn) =>
      turn.items.some(
        (item) =>
          item.status === 'inProgress' &&
          (item.type === 'approval' || item.type === 'toolCall')
      )
    );
  const isRunning =
    Boolean(thread.activeRunId) ||
    thread.turns.some((turn) => turn.status === 'inProgress' || turn.status === 'queued');

  React.useEffect(() => {
    if (!detailTabs.includes(tab)) setTab('activity');
  }, [detailTabs, tab]);

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 10, padding: 14, borderRadius: 16, borderCurve: 'continuous', backgroundColor: theme.colors.cardBackground }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: needsInput ? '#fbbf24' : isRunning ? '#60a5fa' : '#4ade80' }} />
          <Text selectable style={{ flex: 1, color: theme.colors.text, fontWeight: '700' }}>
            {needsInput ? 'Needs input' : isRunning ? 'Running' : threadStatus(thread)}
          </Text>
          {threadQuery.isFetching ? <ActivityIndicator size="small" color={theme.colors.textMuted} /> : null}
        </View>
        <Text selectable style={{ color: theme.colors.textMuted, lineHeight: 20 }}>
          {thread.objective || 'Remote desktop thread'}
        </Text>
        {thread.lastError ? <Text selectable style={{ color: '#fca5a5', lineHeight: 19 }}>{thread.lastError}</Text> : null}
        <RemoteThreadActions thread={thread} running={isRunning} onDeleted={onDeleted} onForked={onForked} />
      </View>

      <View style={{ flexDirection: 'row', gap: 6 }}>
        {detailTabs.map((candidate) => (
          <TouchableOpacity
            key={candidate}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === candidate }}
            accessibilityLabel={`Remote ${candidate}`}
            onPress={() => setTab(candidate)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12, borderCurve: 'continuous', backgroundColor: tab === candidate ? theme.colors.cardBackground : 'transparent' }}
          >
            <Text style={{ color: tab === candidate ? theme.colors.text : theme.colors.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' }}>{candidate}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'activity' ? <RemoteThreadActivity thread={thread} loading={threadQuery.isLoading} /> : null}
      {tab === 'changes' ? <RemoteReviewPanel /> : null}
      {tab === 'files' ? <RemoteFilesPanel /> : null}
      <RemoteThreadComposer thread={thread} running={isRunning} />
    </View>
  );
}

const threadStatus = (thread: DesktopThread) => {
  if (thread.archived) return 'Archived';
  if (thread.lastError) return 'Failed';
  if (thread.state === 'paused') return 'Paused';
  if (thread.state === 'canceled') return 'Canceled';
  return 'Completed';
};
