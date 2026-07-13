import type { Agent, AgentInput } from '@taskforceai/contracts/contracts';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { useTheme } from '../contexts/ThemeContext';
import { useAgentsQuery, useUpsertAgentMutation } from '../hooks/api/agents';

export type ScheduledFilter = 'active' | 'paused' | 'completed';

const completedStatuses = new Set(['completed', 'complete', 'succeeded', 'success']);
const noAgents: Agent[] = [];

export function scheduledFilterForAgent(agent: Agent): ScheduledFilter {
  if (completedStatuses.has(agent.status.trim().toLowerCase())) {
    return 'completed';
  }
  return agent.autonomy_enabled ? 'active' : 'paused';
}

const displayNameForPrompt = (prompt: string): string => {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0] ?? '';
  return firstLine.length <= 72 ? firstLine : `${firstLine.slice(0, 69).trimEnd()}…`;
};

const currentTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const agentInput = (agent: Agent, autonomyEnabled: boolean): AgentInput => ({
  id: agent.id,
  name: agent.name,
  description: agent.description ?? undefined,
  avatar: agent.avatar ?? undefined,
  modelId: agent.model_id ?? undefined,
  autonomyEnabled,
  timezone: agent.timezone,
  activeStart: agent.active_start,
  activeEnd: agent.active_end,
  activeDays: agent.active_days ?? [],
  check_interval: agent.check_interval,
});

interface ScheduledScreenProps {
  visible: boolean;
  onClose: () => void;
}

export function ScheduledScreen({ visible, onClose }: ScheduledScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<ScheduledFilter>('active');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const agentsQuery = useAgentsQuery(visible);
  const upsertAgent = useUpsertAgentMutation();
  const agents = agentsQuery.data ?? noAgents;
  const filteredAgents = useMemo(
    () => agents.filter((agent) => scheduledFilterForAgent(agent) === filter),
    [agents, filter]
  );

  const createSchedule = async () => {
    const description = prompt.trim();
    if (!description || upsertAgent.isPending) return;

    try {
      await upsertAgent.mutateAsync({
        name: displayNameForPrompt(description),
        description,
        autonomyEnabled: true,
        timezone: currentTimezone(),
        activeStart: '00:00',
        activeEnd: '23:59',
        activeDays: [0, 1, 2, 3, 4, 5, 6],
        check_interval: 600,
      });
      setPrompt('');
      setFilter('active');
    } catch (error) {
      Alert.alert(
        'Unable to schedule task',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  const toggleSchedule = async (agent: Agent) => {
    if (upsertAgent.isPending || scheduledFilterForAgent(agent) === 'completed') return;
    try {
      await upsertAgent.mutateAsync(agentInput(agent, !agent.autonomy_enabled));
    } catch (error) {
      Alert.alert(
        'Unable to update task',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  const filterLabel = filter[0].toUpperCase() + filter.slice(1);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView
        edges={['top', 'bottom']}
        style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
      >
        <KeyboardAvoidingView
          style={styles.safeArea}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.headerButton, { backgroundColor: theme.colors.cardBackground }]}
              accessibilityRole="button"
              accessibilityLabel="Back to chat"
            >
              <Icon name="ChevronLeft" size={20} color={theme.colors.text} />
            </TouchableOpacity>
            <Text style={[styles.title, { color: theme.colors.text }]}>Scheduled</Text>
            <TouchableOpacity
              onPress={() => setIsFilterOpen(true)}
              style={[styles.headerButton, styles.filterButton]}
              accessibilityRole="button"
              accessibilityLabel={`Filter scheduled tasks. ${filterLabel} selected`}
            >
              <Icon name="SlidersHorizontal" size={20} color="#07101f" strokeWidth={2.25} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.list}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={agentsQuery.isRefetching}
                onRefresh={() => void agentsQuery.refetch()}
              />
            }
          >
            {agentsQuery.isLoading ? (
              <ActivityIndicator color={theme.colors.primary} style={styles.loading} />
            ) : agentsQuery.isError ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>Tasks unavailable</Text>
                <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>Pull to try again.</Text>
              </View>
            ) : filteredAgents.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>No {filter} tasks</Text>
                <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>Create one below or choose another filter.</Text>
              </View>
            ) : (
              filteredAgents.map((agent) => (
                <TouchableOpacity
                  key={agent.id}
                  onPress={() => void toggleSchedule(agent)}
                  activeOpacity={0.72}
                  style={[styles.taskCard, { borderColor: theme.colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${agent.name}. ${agent.description ?? ''}`.trim()}
                  accessibilityHint={filter === 'active' ? 'Pause scheduled task' : filter === 'paused' ? 'Resume scheduled task' : undefined}
                >
                  <View style={styles.taskHeading}>
                    <Text style={styles.avatar}>{agent.avatar || '⏱️'}</Text>
                    <Text style={[styles.taskName, { color: theme.colors.text }]} numberOfLines={2}>
                      {agent.name}
                    </Text>
                    {filter !== 'completed' ? (
                      <Icon
                        name={filter === 'active' ? 'Pause' : 'Play'}
                        size={19}
                        color={theme.colors.textMuted}
                      />
                    ) : (
                      <Icon name="Check" size={19} color={theme.colors.primary} />
                    )}
                  </View>
                  {agent.description ? (
                    <Text style={[styles.taskDescription, { color: theme.colors.textMuted }]}>
                      {agent.description}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))
            )}
          </ScrollView>

          <View
            style={[
              styles.composer,
              {
                backgroundColor: theme.colors.cardBackground,
                borderColor: theme.colors.border,
                marginBottom: Math.max(insets.bottom, 10),
              },
            ]}
          >
            <Icon name="Plus" size={22} color={theme.colors.text} />
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Schedule a task"
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.input, { color: theme.colors.text }]}
              accessibilityLabel="Schedule a task"
              returnKeyType="send"
              onSubmitEditing={() => void createSchedule()}
            />
            <TouchableOpacity
              onPress={() => void createSchedule()}
              disabled={!prompt.trim() || upsertAgent.isPending}
              style={[
                styles.sendButton,
                { opacity: !prompt.trim() || upsertAgent.isPending ? 0.35 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Create scheduled task"
            >
              {upsertAgent.isPending ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Icon name="Send" size={17} color="#ffffff" />
              )}
            </TouchableOpacity>
          </View>

          <Modal visible={isFilterOpen} transparent animationType="fade" onRequestClose={() => setIsFilterOpen(false)}>
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setIsFilterOpen(false)}
              style={styles.filterOverlay}
            >
              <View style={[styles.filterMenu, { backgroundColor: theme.colors.surface }]}>
                {(['active', 'paused', 'completed'] as const).map((option) => (
                  <TouchableOpacity
                    key={option}
                    onPress={() => {
                      setFilter(option);
                      setIsFilterOpen(false);
                    }}
                    style={styles.filterRow}
                    accessibilityRole="menuitem"
                    accessibilityLabel={`Show ${option} scheduled tasks`}
                  >
                    <View style={styles.checkSlot}>
                      {filter === option ? <Icon name="Check" size={18} color={theme.colors.text} /> : null}
                    </View>
                    <Text style={[styles.filterText, { color: theme.colors.text }]}>
                      {option[0].toUpperCase() + option.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  headerButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  filterButton: { backgroundColor: '#1688ff' },
  title: { fontSize: 20, fontWeight: '700' },
  list: { flex: 1 },
  listContent: { gap: 14, paddingHorizontal: 20, paddingBottom: 18, paddingTop: 8 },
  loading: { paddingTop: 48 },
  emptyState: { alignItems: 'center', gap: 6, paddingHorizontal: 24, paddingVertical: 52 },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  taskCard: {
    borderRadius: 22,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 19,
  },
  taskHeading: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  avatar: { fontSize: 20 },
  taskName: { flex: 1, fontSize: 17, fontWeight: '600', lineHeight: 22 },
  taskDescription: { fontSize: 15, lineHeight: 21 },
  composer: {
    alignItems: 'center',
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  input: { flex: 1, fontSize: 16, minHeight: 36, paddingVertical: 6 },
  sendButton: {
    alignItems: 'center',
    backgroundColor: '#1688ff',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  filterOverlay: { backgroundColor: 'rgba(0,0,0,0.35)', flex: 1, paddingHorizontal: 24, paddingTop: 88 },
  filterMenu: { alignSelf: 'flex-end', borderRadius: 20, minWidth: 220, overflow: 'hidden', paddingVertical: 10 },
  filterRow: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingVertical: 13 },
  checkSlot: { alignItems: 'center', width: 20 },
  filterText: { fontSize: 17 },
});
