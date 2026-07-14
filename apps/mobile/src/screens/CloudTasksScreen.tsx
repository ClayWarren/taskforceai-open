import type { ActiveTask } from '@taskforceai/contracts/contracts';
import React from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { useTheme } from '../contexts/ThemeContext';
import { useCloudTasksQuery } from '../hooks/api/cloudTasks';

interface CloudTasksScreenProps {
  visible: boolean;
  onClose: () => void;
  onCreate: () => void;
}

export function CloudTasksScreen({ visible, onClose, onCreate }: CloudTasksScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = React.useState('');
  const tasksQuery = useCloudTasksQuery(visible);
  const tasks = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    const all = tasksQuery.data ?? [];
    if (!query) return all;
    return all.filter((task) => `${task.prompt ?? ''} ${task.status}`.toLowerCase().includes(query));
  }, [search, tasksQuery.data]);

  React.useEffect(() => {
    if (!visible) setSearch('');
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView
        edges={['bottom']}
        style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
          <View style={styles.headerSpacer} />
          <View style={styles.headerTitleGroup}>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>TaskForceAI</Text>
            <Text style={[styles.headerSubtitle, { color: theme.colors.textMuted }]}>Cloud tasks</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close Cloud tasks"
            onPress={onClose}
            style={[styles.closeButton, { backgroundColor: theme.colors.cardBackground }]}
          >
            <Icon name="X" size={22} color={theme.colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={tasks.length === 0 ? styles.emptyList : styles.list}
          showsVerticalScrollIndicator={false}
        >
          {tasksQuery.isLoading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : tasksQuery.isError ? (
            <EmptyState title="Cloud tasks unavailable" detail="Close and reopen to try again." />
          ) : tasks.length > 0 ? (
            tasks.map((task) => <CloudTaskRow key={task.task_id} task={task} />)
          ) : search ? (
            <EmptyState title="No matching cloud tasks" detail="Try another search." />
          ) : (
            <EmptyState title="No cloud tasks yet" detail="Start a cloud task to see it here." />
          )}
        </ScrollView>

        <View style={styles.bottomBar}>
          <View style={[styles.search, { backgroundColor: theme.colors.cardBackground }]}>
            <Icon name="Search" size={20} color={theme.colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search Tasks"
              placeholderTextColor={theme.colors.textMuted}
              accessibilityLabel="Search Cloud tasks"
              style={[styles.searchInput, { color: theme.colors.text }]}
            />
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Start Cloud task"
            onPress={onCreate}
            style={styles.createButton}
          >
            <Icon name="Plus" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.emptyState}>
      <Icon name="Cloud" size={62} color={theme.colors.textMuted} />
      <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[styles.emptyDetail, { color: theme.colors.textMuted }]}>{detail}</Text>
    </View>
  );
}

function CloudTaskRow({ task }: { task: ActiveTask }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.taskRow, { borderColor: theme.colors.border }]}>
      <View style={styles.taskCopy}>
        <Text style={[styles.taskTitle, { color: theme.colors.text }]} numberOfLines={2}>
          {task.prompt?.trim() || 'Cloud task'}
        </Text>
        <Text style={[styles.taskStatus, { color: theme.colors.textMuted }]}>{task.status}</Text>
      </View>
      <View style={[styles.taskDot, { backgroundColor: taskStatusColor(task.status) }]} />
    </View>
  );
}

const taskStatusColor = (status: string): string => {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'succeeded') return '#22c55e';
  if (normalized === 'failed' || normalized === 'cancelled') return '#ef4444';
  return '#3b82f6';
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  headerSpacer: { height: 44, width: 44 },
  headerTitleGroup: { alignItems: 'center', flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSubtitle: { fontSize: 12, marginTop: 1 },
  closeButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  list: { gap: 10, padding: 20 },
  emptyList: { flexGrow: 1, paddingHorizontal: 24 },
  emptyState: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingBottom: 80 },
  emptyTitle: { fontSize: 22, fontWeight: '700', marginTop: 22 },
  emptyDetail: { fontSize: 16, lineHeight: 23, marginTop: 6, textAlign: 'center' },
  taskRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 68,
    paddingVertical: 10,
  },
  taskCopy: { flex: 1, minWidth: 0 },
  taskTitle: { fontSize: 16, fontWeight: '600', lineHeight: 21 },
  taskStatus: { fontSize: 13, marginTop: 3, textTransform: 'capitalize' },
  taskDot: { borderRadius: 5, height: 10, width: 10 },
  bottomBar: { alignItems: 'center', flexDirection: 'row', gap: 12, padding: 16 },
  search: {
    alignItems: 'center',
    borderRadius: 24,
    flex: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  createButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
});
