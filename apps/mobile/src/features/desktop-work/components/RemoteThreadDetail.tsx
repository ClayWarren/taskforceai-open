import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { useTheme } from '../../../contexts/ThemeContext';
import { useDesktopThreadQuery, type DesktopThread } from '../data/desktop-work';
import { RemoteChangeSummaryPill } from './RemoteReviewPanel';
import { RemoteThreadActions } from './RemoteThreadActions';
import { RemoteThreadActivity } from './RemoteThreadActivity';
import { RemoteThreadComposer } from './RemoteThreadComposer';

export function RemoteThreadDetail({
  summary,
  workspace,
  onDeleted,
  onForked,
  hasPendingInteraction = false,
  changesVisible = false,
  onChangesVisibleChange,
  onOpenFiles,
  onOpenReview,
  onOpenGit,
  onNewThread,
}: {
  summary: DesktopThread;
  workspace?: string | null;
  onDeleted: () => void;
  onForked: (thread: DesktopThread) => void;
  hasPendingInteraction?: boolean;
  changesVisible?: boolean;
  onChangesVisibleChange?: (visible: boolean) => void;
  onOpenFiles?: () => void;
  onOpenReview?: () => void;
  onOpenGit?: () => void;
  onNewThread?: () => void;
}) {
  const { theme } = useTheme();
  const threadQuery = useDesktopThreadQuery(summary.id, true);
  const thread = threadQuery.data ?? summary;
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

      <RemoteThreadActivity thread={thread} loading={threadQuery.isLoading} />
      {thread.taskMode === 'code' ? (
        <RemoteChangeSummaryPill
          workspace={workspace}
          visible={changesVisible}
          onVisibleChange={onOpenReview ? (visible) => { if (visible) onOpenReview(); } : onChangesVisibleChange}
        />
      ) : null}
      <RemoteThreadComposer
        thread={thread}
        running={isRunning}
        workspace={workspace}
        onOpenFiles={onOpenFiles}
        onOpenReview={onOpenReview}
        onOpenGit={thread.taskMode === 'code' ? onOpenGit : undefined}
        onNewThread={onNewThread}
      />
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
