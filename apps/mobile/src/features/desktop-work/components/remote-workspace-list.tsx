import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Icon } from '../../../components/Icon';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  filterRemoteThreads,
  makeRemoteSections,
  remoteThreadFilters,
  type RemoteOrganizeMode,
  type RemoteThreadFilter,
  type WorkspaceGroup,
} from '../desktop-work-sections';
import { desktopWorkStyles as styles } from '../desktop-work-styles';
import {
  useDesktopWorkStateQuery,
  type DesktopInteractionRequest,
  type DesktopProject,
  type DesktopThread,
} from '../data/desktop-work';
import type { RemoteNewThreadPreset } from './RemoteNewThreadComposer';

interface RemoteWorkspaceListProps {
  desktopWork: ReturnType<typeof useDesktopWorkStateQuery>;
  machineName: string;
  projects: DesktopProject[];
  threads: DesktopThread[];
  interactions: DesktopInteractionRequest[];
  activeProjectId: number | null;
  organizeMode: RemoteOrganizeMode;
  filter: RemoteThreadFilter;
  onFilterChange: (_filter: RemoteThreadFilter) => void;
  onOpenThread: (thread: DesktopThread) => void;
  onLongPressThread: (thread: DesktopThread) => void;
  onNewThread: (preset: RemoteNewThreadPreset) => void;
}

export function RemoteWorkspaceList({
  desktopWork,
  machineName,
  projects,
  threads,
  interactions,
  activeProjectId,
  organizeMode,
  filter,
  onFilterChange,
  onOpenThread,
  onLongPressThread,
  onNewThread,
}: RemoteWorkspaceListProps) {
  const { theme } = useTheme();
  const [search, setSearch] = React.useState('');
  const filteredThreads = React.useMemo(
    () => filterRemoteThreads(threads, interactions, search, filter),
    [filter, interactions, search, threads]
  );
  const workspaceSections = React.useMemo(
    () => makeRemoteSections(projects, filteredThreads, activeProjectId, organizeMode),
    [activeProjectId, filteredThreads, organizeMode, projects]
  );
  const connected = desktopWork.data?.status === 'connected';

  return (
    <View style={styles.workspaceBrowser}>
      <View style={styles.connectedHeader}>
        <View style={[styles.workspaceIcon, { borderColor: theme.colors.border }]}>
          <Icon name="Monitor" size={16} color={theme.colors.text} />
        </View>
        <View style={styles.workspaceText}>
          <Text style={[styles.workspaceTitle, { color: theme.colors.text }]}>
            {connected ? machineName : 'Desktop app'}
          </Text>
          <Text style={[styles.workspaceSubtitle, { color: theme.colors.textMuted }]}>
            {connected ? 'Connected desktop' : 'Not connected'}
          </Text>
        </View>
        <View
          style={[
            styles.connectedDot,
            { backgroundColor: connected ? '#22c55e' : '#9ca3af' },
          ]}
        />
      </View>

      <View style={[styles.remoteSearch, { backgroundColor: theme.colors.cardBackground }]}>
        <Icon name="Search" size={16} color={theme.colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search remote threads"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="Search remote threads"
          style={[styles.remoteSearchInput, { color: theme.colors.text }]}
        />
        {search ? (
          <TouchableOpacity
            accessibilityLabel="Clear remote thread search"
            onPress={() => setSearch('')}
          >
            <Icon name="X" size={15} color={theme.colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.remoteFilters}
      >
        {remoteThreadFilters.map((candidate) => (
          <TouchableOpacity
            key={candidate.value}
            accessibilityRole="button"
            accessibilityLabel={`Filter remote threads: ${candidate.label}`}
            accessibilityState={{ selected: filter === candidate.value }}
            onPress={() => onFilterChange(candidate.value)}
            style={[
              styles.remoteFilter,
              {
                backgroundColor:
                  filter === candidate.value ? '#1d4ed8' : theme.colors.cardBackground,
              },
            ]}
          >
            <Text style={{ color: theme.colors.text, fontSize: 11, fontWeight: '600' }}>
              {candidate.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {desktopWork.isLoading ? (
        <StatusBlock message="Loading desktop work..." />
      ) : desktopWork.isError || desktopWork.data?.status === 'unpaired' ? (
        <StatusBlock message={connectionMessage(desktopWork)} framed />
      ) : workspaceSections.length === 0 ? (
        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
          No matching remote threads.
        </Text>
      ) : (
        workspaceSections.map((section) => (
          <View key={section.key} style={styles.workspaceSection}>
            <View style={styles.workspaceSectionHeader}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                {section.title}
              </Text>
              {section.kind === 'dated' ? (
                <Icon name="ChevronDown" size={14} color={theme.colors.textMuted} />
              ) : null}
              {section.kind === 'chats' ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Start new Chats thread"
                  onPress={() => onNewThread({ taskMode: 'chat', projectId: null })}
                  style={styles.newThreadBtn}
                >
                  <Icon name="SquarePen" size={18} color={theme.colors.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>
            {section.workspaces.map((workspace) => (
              <WorkspaceGroupView
                key={workspace.name}
                workspace={workspace}
                onOpenThread={onOpenThread}
                onLongPressThread={onLongPressThread}
                onNewThread={() =>
                  onNewThread({ taskMode: 'code', projectId: workspace.projectId })
                }
              />
            ))}
            {section.threads.map((thread, index) => (
              <RemoteThreadRow
                key={`${section.key}-${thread.sessionId}-${index}`}
                thread={thread}
                onOpenThread={onOpenThread}
                onLongPressThread={onLongPressThread}
              />
            ))}
          </View>
        ))
      )}
    </View>
  );
}

function StatusBlock({ message, framed = false }: { message: string; framed?: boolean }) {
  const { theme } = useTheme();

  return (
    <View
      style={[
        styles.statusBlock,
        framed ? { backgroundColor: theme.colors.cardBackground } : null,
      ]}
    >
      {!framed ? <ActivityIndicator color={theme.colors.text} size="small" /> : null}
      <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>{message}</Text>
    </View>
  );
}

function WorkspaceGroupView({
  workspace,
  onOpenThread,
  onLongPressThread,
  onNewThread,
}: {
  workspace: WorkspaceGroup;
  onOpenThread: (thread: DesktopThread) => void;
  onLongPressThread: (thread: DesktopThread) => void;
  onNewThread: () => void;
}) {
  const { theme } = useTheme();

  return (
    <View style={styles.workspaceGroup}>
      <View style={styles.workspaceGroupHeader}>
        <View style={styles.workspaceGroupTitle}>
          <Icon name="Database" size={19} color={theme.colors.text} />
          <Text
            style={[styles.workspaceGroupName, { color: theme.colors.text }]}
            numberOfLines={1}
          >
            {workspace.name}
          </Text>
          <Icon
            name={workspace.expanded ? 'ChevronDown' : 'ChevronRight'}
            size={14}
            color={theme.colors.textMuted}
          />
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Start new ${workspace.name} thread`}
          onPress={onNewThread}
          activeOpacity={0.72}
          style={styles.newThreadBtn}
        >
          <Icon name="SquarePen" size={18} color={theme.colors.textMuted} />
        </TouchableOpacity>
      </View>

      {workspace.threads.length === 0 ? (
        <Text style={[styles.emptyThreadText, { color: theme.colors.textMuted }]}>No threads yet.</Text>
      ) : (
        workspace.threads.map((thread, index) => (
          <RemoteThreadRow
            key={`${workspace.name}-${thread.sessionId}-${index}`}
            thread={thread}
            onOpenThread={onOpenThread}
            onLongPressThread={onLongPressThread}
            nested
          />
        ))
      )}
    </View>
  );
}

function RemoteThreadRow({
  thread,
  onOpenThread,
  onLongPressThread,
  nested = false,
}: {
  thread: DesktopThread;
  onOpenThread: (thread: DesktopThread) => void;
  onLongPressThread: (thread: DesktopThread) => void;
  nested?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      onPress={() => onOpenThread(thread)}
      onLongPress={() => onLongPressThread(thread)}
      delayLongPress={350}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`Open active session: ${thread.title}`}
      style={[styles.threadRow, nested ? styles.nestedThreadRow : null]}
    >
      <Text style={[styles.threadTitle, { color: theme.colors.text }]} numberOfLines={1}>
        {thread.title}
      </Text>
      {thread.state === 'running' || thread.activeRunId ? (
        <View
          style={[styles.threadStatus, { borderColor: theme.colors.border }]}
          accessibilityLabel="Active thread running"
        />
      ) : null}
    </TouchableOpacity>
  );
}

const connectionMessage = (
  desktopWork: ReturnType<typeof useDesktopWorkStateQuery>
): string => {
  if (desktopWork.error instanceof Error) {
    return desktopWork.error.message;
  }
  if (desktopWork.data?.status === 'unpaired') {
    return desktopWork.data.message;
  }
  return 'Connect the desktop app to view live work.';
};
