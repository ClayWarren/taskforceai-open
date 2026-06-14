import { spacingTokens } from '@taskforceai/design-tokens';
import type { ActiveTask } from '@taskforceai/contracts/contracts';
import { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import {
  useApproveDesktopSessionMutation,
  useDesktopSessionsQuery,
} from '../hooks/api/desktopSessions';
import { Icon } from './Icon';

const formatUpdatedAt = (updatedAt?: number) => {
  if (!updatedAt) {
    return 'just now';
  }
  const ageMs = Math.max(0, Date.now() - updatedAt * 1000);
  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMinutes < 1) {
    return 'just now';
  }
  if (ageMinutes === 1) {
    return '1m ago';
  }
  return `${ageMinutes}m ago`;
};

const formatThreadLabel = (conversationId?: number) =>
  typeof conversationId === 'number' ? `Thread #${conversationId}` : 'Desktop thread';

const sessionTone = (session: ActiveTask) => {
  if (session.pending_approval) {
    return { label: 'Needs approval', color: '#fbbf24' };
  }
  if (session.status === 'processing') {
    return { label: 'Running', color: '#60a5fa' };
  }
  return { label: session.status, color: '#94a3b8' };
};

interface DesktopSessionsProps {
  showEmpty?: boolean;
  inset?: boolean;
  title?: string;
  variant?: 'strip' | 'sidebar';
  onOpen?: () => void;
}

const SessionChips = ({
  session,
  maxTools,
  includeProgress = false,
}: {
  session: ActiveTask;
  maxTools: number;
  includeProgress?: boolean;
}) => {
  const tools = session.client_mcp_tools ?? [];

  return (
    <View className="flex-row flex-wrap gap-xs">
      {includeProgress && (
        <View className="flex-row items-center gap-1 rounded-full border border-border/50 px-2 py-1">
          <Icon name="Activity" size={10} color="#a5b4fc" />
          <Text className="text-[10px] font-medium text-text-muted">Progress</Text>
        </View>
      )}
      {session.computer_use && (
        <View className="flex-row items-center gap-1 rounded-full border border-border/50 px-2 py-1">
          <Icon name="Monitor" size={10} color="#93c5fd" />
          <Text className="text-[10px] font-medium text-[#bfdbfe]">Screen</Text>
        </View>
      )}
      <View className="flex-row items-center gap-1 rounded-full border border-border/50 px-2 py-1">
        <Icon name="Check" size={10} color="#86efac" />
        <Text className="text-[10px] font-medium text-text-muted">Approvals</Text>
      </View>
      {tools.slice(0, maxTools).map((tool) => (
        <View
          key={`${tool.server_name}:${tool.tool_name}`}
          className="rounded-full border border-border/50 px-2 py-1"
        >
          <Text className="text-[10px] font-medium text-text-muted" numberOfLines={1}>
            {tool.title || tool.tool_name}
          </Text>
        </View>
      ))}
    </View>
  );
};

const ApprovalControls = ({
  session,
  onApprove,
}: {
  session: ActiveTask;
  onApprove: (taskId: string, approved: boolean) => void;
}) => {
  const approval = session.pending_approval;
  if (!approval) {
    return null;
  }

  return (
    <View className="mt-sm">
      <Text className="mb-xs text-text-muted text-[10px]" numberOfLines={2}>
        {approval.agent_name || 'Agent'} needs {approval.permission || 'approval'}
      </Text>
      <View className="flex-row gap-xs">
        <TouchableOpacity
          onPress={() => onApprove(session.task_id, true)}
          className="h-8 flex-1 flex-row items-center justify-center gap-xs rounded-md"
          accessibilityRole="button"
          accessibilityLabel="Approve desktop session action"
          style={{ backgroundColor: 'rgba(34, 197, 94, 0.18)' }}
        >
          <Icon name="Check" size={13} color="#86efac" />
          <Text className="text-[11px] font-semibold text-[#bbf7d0]">Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onApprove(session.task_id, false)}
          className="h-8 w-9 items-center justify-center rounded-md"
          accessibilityRole="button"
          accessibilityLabel="Deny desktop session action"
          style={{ backgroundColor: 'rgba(248, 113, 113, 0.14)' }}
        >
          <Icon name="X" size={13} color="#fca5a5" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

export function DesktopSessions({
  showEmpty = false,
  inset = true,
  title = 'Live desktop work',
  variant = 'strip',
  onOpen,
}: DesktopSessionsProps) {
  const sessionsQuery = useDesktopSessionsQuery();
  const approvalMutation = useApproveDesktopSessionMutation();
  const sessions = sessionsQuery.data ?? [];

  const waitingCount = useMemo(
    () => sessions.filter((session) => session.pending_approval).length,
    [sessions]
  );

  if (sessions.length === 0 && !showEmpty) {
    return null;
  }

  const approveSession = (taskId: string, approved: boolean) => {
    void approvalMutation.mutateAsync({
      taskId,
      decision: approved ? { approved: true } : { approved: false, error: 'Denied from mobile' },
    });
  };

  if (variant === 'sidebar') {
    const HeaderContainer = onOpen ? TouchableOpacity : View;
    const cardAccessibility = onOpen
      ? {
          accessibilityRole: 'button' as const,
          accessibilityLabel: 'Open desktop work',
          accessibilityHint: 'Opens active desktop sessions and approvals.',
        }
      : {};

    return (
      <View className={inset ? 'px-md pb-sm' : undefined}>
        <View className="px-xs pb-xs">
          <HeaderContainer
            className="mb-xs flex-row items-center justify-between gap-sm"
            onPress={onOpen}
            activeOpacity={0.72}
            {...cardAccessibility}
          >
            <View className="min-w-0 flex-1 flex-row items-center gap-xs">
              <Icon name="Monitor" size={14} color="#cbd5e1" />
              <Text className="text-text text-xs font-semibold" numberOfLines={1}>
                {title}
              </Text>
            </View>
            <View className="flex-row items-center gap-xs">
              <Text className="text-text-muted text-[11px]" numberOfLines={1}>
                {waitingCount > 0 ? `${waitingCount} waiting` : `${sessions.length} active`}
              </Text>
              {onOpen ? <Icon name="ChevronRight" size={12} color="#94a3b8" /> : null}
            </View>
          </HeaderContainer>

          {sessions.length === 0 ? (
            <TouchableOpacity
              activeOpacity={onOpen ? 0.72 : 1}
              onPress={onOpen}
              disabled={!onOpen}
              accessibilityRole={onOpen ? 'button' : undefined}
              accessibilityLabel={onOpen ? 'Open desktop work' : undefined}
              className="rounded-lg border border-border/60 px-sm py-xs"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}
            >
              <Text className="text-text text-xs font-medium">No desktop work is active.</Text>
              <Text className="mt-1 text-text-muted text-[11px]">
                Start from your Mac, then follow it here.
              </Text>
            </TouchableOpacity>
          ) : (
            <View className="gap-xs">
              {sessions.slice(0, 4).map((session) => {
                const tone = sessionTone(session);
                return (
                  <TouchableOpacity
                    key={session.task_id}
                    activeOpacity={onOpen ? 0.72 : 1}
                    onPress={onOpen}
                    disabled={!onOpen}
                    accessibilityRole={onOpen ? 'button' : undefined}
                    accessibilityLabel={onOpen ? `Open desktop work: ${session.prompt || 'Desktop task'}` : undefined}
                    className="rounded-lg border border-border/60 px-sm py-xs"
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}
                  >
                    <View className="flex-row items-center gap-xs">
                      <View
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: tone.color }}
                      />
                      <Text className="text-text text-[11px] font-semibold" numberOfLines={1}>
                        {tone.label}
                      </Text>
                      <Text className="text-text-muted text-[10px]" numberOfLines={1}>
                        {formatUpdatedAt(session.updated_at)}
                      </Text>
                    </View>
                    <Text className="mt-1 text-text text-xs font-medium" numberOfLines={2}>
                      {session.prompt || 'Desktop task'}
                    </Text>
                    <Text className="mt-1 text-text-muted text-[10px]" numberOfLines={1}>
                      Mac · {formatThreadLabel(session.conversation_id)} ·{' '}
                      {session.model_id || session.task_id}
                    </Text>
                    <View className="mt-xs">
                      <SessionChips session={session} maxTools={1} />
                    </View>
                    <ApprovalControls session={session} onApprove={approveSession} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View className={inset ? 'px-md pb-sm' : undefined}>
      <View
        className="rounded-lg border border-border/70 px-sm py-sm"
        style={{ backgroundColor: 'rgba(12, 18, 30, 0.88)' }}
      >
        <View className="mb-xs flex-row items-center justify-between gap-sm">
          <View className="min-w-0 flex-1 flex-row items-center gap-xs">
            <Icon name="Monitor" size={14} color="#cbd5e1" />
            <Text className="text-text text-xs font-semibold" numberOfLines={1}>
              {title}
            </Text>
            <Text className="text-text-muted text-[11px]" numberOfLines={1}>
              {waitingCount > 0 ? `${waitingCount} waiting` : `${sessions.length} active`}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => void sessionsQuery.refetch()}
            className="h-7 w-7 items-center justify-center rounded-full"
            accessibilityRole="button"
            accessibilityLabel="Refresh desktop sessions"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
          >
            <Icon name="Activity" size={13} color="#cbd5e1" />
          </TouchableOpacity>
        </View>

        {sessions.length === 0 ? (
          <View
            className="rounded-lg border border-border/60 p-sm"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}
          >
            <Text className="text-text text-xs font-medium">No desktop work is active.</Text>
            <Text className="mt-1 text-text-muted text-[11px]">
              Start work on your Mac, then use mobile to follow progress and approve the next step.
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacingTokens.xs }}
          >
            {sessions.map((session) => {
              const tone = sessionTone(session);
              return (
                <View
                  key={session.task_id}
                  className="w-[304px] rounded-lg border border-border/60 p-sm"
                  style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}
                >
                  <View className="mb-xs flex-row items-center justify-between gap-xs">
                    <View className="min-w-0 flex-1 flex-row items-center gap-xs">
                      <View
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: tone.color }}
                      />
                      <Text className="text-text text-[11px] font-semibold" numberOfLines={1}>
                        {tone.label}
                      </Text>
                      <Text className="text-text-muted text-[10px]" numberOfLines={1}>
                        {formatUpdatedAt(session.updated_at)}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-1 rounded-full border border-border/50 px-2 py-1">
                      <Icon name="Monitor" size={10} color="#93c5fd" />
                      <Text className="text-[10px] font-semibold text-[#bfdbfe]">Mac</Text>
                    </View>
                  </View>

                  <Text className="text-text text-xs font-semibold" numberOfLines={2}>
                    {session.prompt || 'Desktop task'}
                  </Text>
                  <Text className="mt-1 text-text-muted text-[10px]" numberOfLines={1}>
                    {formatThreadLabel(session.conversation_id)} ·{' '}
                    {session.model_id || session.task_id}
                  </Text>

                  <View
                    className="mt-sm rounded-md border border-border/50 p-xs"
                    style={{ backgroundColor: 'rgba(15, 23, 42, 0.7)' }}
                  >
                    <Text className="text-[10px] font-semibold uppercase tracking-[0.6px] text-text-muted">
                      Live on this phone
                    </Text>
                    <View className="mt-xs">
                      <SessionChips session={session} maxTools={2} includeProgress />
                    </View>
                  </View>

                  <ApprovalControls session={session} onApprove={approveSession} />
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}
