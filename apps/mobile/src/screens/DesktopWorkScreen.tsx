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
import { RemoteFilesSheet } from '../components/remote/RemoteFilesPanel';
import { RemoteThreadDetail } from '../components/remote/RemoteThreadDetail';
import { RemoteInteractionCards } from '../components/remote/RemoteInteractionCards';
import { useTheme } from '../contexts/ThemeContext';
import {
  useDesktopWorkStateQuery,
  useStartDesktopThreadMutation,
  type DesktopInteractionRequest,
  type DesktopProject,
  type DesktopThread,
  type DesktopWorkState,
} from '../hooks/api/desktopWork';

interface DesktopWorkScreenProps {
  visible: boolean;
  initialThreadId?: string | null;
  onClose: () => void;
  onOpenSettings: () => void;
}

type DesktopView = 'workspaces' | 'session' | 'newThread';
type RemoteOrganizeMode = 'project' | 'chronological' | 'chatsFirst';
type RemoteSessionSheet = 'changes' | 'files' | null;

const desktopWorkView = (
  workState: DesktopWorkState | undefined,
  selectedThreadId: string | null,
  createdThread: DesktopThread | null
) => {
  const connected = workState?.status === 'connected' ? workState : null;
  const threads = connected?.threads ?? [];
  const selectedThread = selectedThreadId
    ? threads.find((thread) => thread.sessionId === selectedThreadId) ??
      (createdThread?.sessionId === selectedThreadId ? createdThread : null)
    : (threads[0] ?? null);
  return {
    threads,
    projects: connected?.projects ?? [],
    interactions: connected?.interactions ?? [],
    activeProjectId: connected?.activeProjectId ?? null,
    machineName: connected?.machineName ?? 'Desktop',
    selectedThread,
  };
};

export function DesktopWorkScreen({ visible, initialThreadId = null, onClose, onOpenSettings }: DesktopWorkScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [activeView, setActiveView] = React.useState<DesktopView>('workspaces');
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(null);
  const [createdThread, setCreatedThread] = React.useState<DesktopThread | null>(null);
  const [workspaceMenuVisible, setWorkspaceMenuVisible] = React.useState(false);
  const [sessionMenuVisible, setSessionMenuVisible] = React.useState(false);
  const [sessionSheet, setSessionSheet] = React.useState<RemoteSessionSheet>(null);
  const [organizeMode, setOrganizeMode] = React.useState<RemoteOrganizeMode>('project');
  const [filter, setFilter] = React.useState<RemoteThreadFilter>('all');
  const desktopWork = useDesktopWorkStateQuery(visible);
  const workState = desktopWork.data;
  const {
    threads,
    projects,
    interactions,
    activeProjectId,
    machineName,
    selectedThread,
  } =
    desktopWorkView(workState, selectedThreadId, createdThread);
  const title = headerTitle(activeView, selectedThread);

  React.useEffect(() => {
    if (!visible) {
      return;
    }
    setActiveView(initialThreadId ? 'session' : 'workspaces');
    setSelectedThreadId(initialThreadId);
    setCreatedThread(null);
    setSessionMenuVisible(false);
    setSessionSheet(null);
  }, [initialThreadId, visible]);

  const openThread = (thread: DesktopThread) => {
    setSelectedThreadId(thread.sessionId);
    setActiveView('session');
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
          <View style={styles.headerSlot}>
            <TouchableOpacity
              onPress={activeView === 'workspaces' ? onClose : () => setActiveView('workspaces')}
              style={[styles.headerBtn, { backgroundColor: theme.colors.cardBackground }]}
              accessibilityRole="button"
              accessibilityLabel={activeView === 'workspaces' ? 'Back to chat' : 'Back to desktop workspaces'}
            >
              <Icon name="ChevronLeft" size={20} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            {activeView === 'session' && selectedThread ? (
              <Text style={[styles.headerSubtitle, { color: theme.colors.textMuted }]} numberOfLines={1}>
                {activeProjectName(projects, activeProjectId)} · {machineName}
              </Text>
            ) : null}
          </View>

          <View style={styles.headerSlot}>
            {activeView === 'workspaces' || (activeView === 'session' && selectedThread?.taskMode === 'code') ? (
              <TouchableOpacity
                onPress={() => activeView === 'workspaces' ? setWorkspaceMenuVisible(true) : setSessionMenuVisible(true)}
                style={[styles.headerBtn, { backgroundColor: theme.colors.cardBackground }]}
                accessibilityRole="button"
                accessibilityLabel={activeView === 'workspaces' ? 'Open Remote menu' : 'Open remote task menu'}
              >
                <Icon name="MoreHorizontal" size={20} color={theme.colors.text} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 28),
          }}
          showsVerticalScrollIndicator={false}
        >
          {activeView === 'newThread' ? (
            <NewThreadView
              onStarted={(thread) => {
                setCreatedThread(thread);
                setSelectedThreadId(thread.sessionId);
                setActiveView('session');
              }}
            />
          ) : activeView === 'session' && selectedThread ? (
            <View style={{ gap: 12 }}>
              <RemoteInteractionCards
                interactions={interactions.filter(
                  (interaction) =>
                    interaction.threadId === null ||
                    interaction.threadId === selectedThread.sessionId
                )}
              />
              <RemoteThreadDetail
                summary={selectedThread}
                hasPendingInteraction={interactions.some(
                  (interaction) =>
                    interaction.threadId === null ||
                    interaction.threadId === selectedThread.sessionId
                )}
                onDeleted={() => {
                  setSelectedThreadId(null);
                  setActiveView('workspaces');
                }}
                onForked={(thread) => {
                  setCreatedThread(thread);
                  setSelectedThreadId(thread.sessionId);
                }}
                changesVisible={sessionSheet === 'changes'}
                onChangesVisibleChange={(nextVisible) => setSessionSheet(nextVisible ? 'changes' : null)}
              />
            </View>
          ) : (
            <WorkspaceListView
              desktopWork={desktopWork}
              machineName={machineName}
              projects={projects}
              threads={threads}
              interactions={interactions}
              activeProjectId={activeProjectId}
              organizeMode={organizeMode}
              filter={filter}
              onFilterChange={setFilter}
              onOpenThread={openThread}
              onNewThread={() => setActiveView('newThread')}
            />
          )}
        </ScrollView>
        <RemoteMenu
          visible={workspaceMenuVisible}
          organizeMode={organizeMode}
          onClose={() => setWorkspaceMenuVisible(false)}
          onOrganize={(mode) => {
            setOrganizeMode(mode);
            setWorkspaceMenuVisible(false);
          }}
          onCloudTasks={() => {
            setWorkspaceMenuVisible(false);
            onClose();
          }}
          onArchived={() => {
            setFilter('archived');
            setWorkspaceMenuVisible(false);
          }}
          onSettings={() => {
            setWorkspaceMenuVisible(false);
            onOpenSettings();
          }}
        />
        <RemoteTaskMenu
          visible={sessionMenuVisible}
          onClose={() => setSessionMenuVisible(false)}
          onChanges={() => {
            setSessionMenuVisible(false);
            setSessionSheet('changes');
          }}
          onFiles={() => {
            setSessionMenuVisible(false);
            setSessionSheet('files');
          }}
        />
        <RemoteFilesSheet
          visible={sessionSheet === 'files'}
          onVisibleChange={(nextVisible) => setSessionSheet(nextVisible ? 'files' : null)}
        />
      </SafeAreaView>
    </Modal>
  );
}

function NewThreadView({ onStarted }: { onStarted: (thread: DesktopThread) => void }) {
  const { theme } = useTheme();
  const [prompt, setPrompt] = React.useState('');
  const startThread = useStartDesktopThreadMutation();
  const submit = () => {
    const input = prompt.trim();
    if (!input || startThread.isPending) {
      return;
    }
    startThread.mutate(
      { input },
      {
        onSuccess: (result) => {
          setPrompt('');
          onStarted(result.thread);
        },
      }
    );
  };

  return (
    <View style={styles.sessionSurface}>
      <Text style={[styles.sessionBody, { color: theme.colors.text }]}>
        Start live work on the paired desktop app. The thread will be created on the Mac.
      </Text>
      <View style={[styles.promptForm, { backgroundColor: theme.colors.cardBackground }]}>
        <Icon name="Plus" size={22} color={theme.colors.text} />
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          placeholder="Ask desktop to..."
          placeholderTextColor={theme.colors.textMuted}
          style={[styles.promptInput, { color: theme.colors.text }]}
          returnKeyType="send"
          onSubmitEditing={submit}
          accessibilityLabel="New desktop thread prompt"
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Start desktop thread"
          onPress={submit}
          disabled={!prompt.trim() || startThread.isPending}
          style={styles.stopButton}
        >
          {startThread.isPending ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Icon name="Square" size={16} color="#ffffff" />
          )}
        </TouchableOpacity>
      </View>
      {startThread.error instanceof Error ? <Text style={styles.errorText}>{startThread.error.message}</Text> : null}
    </View>
  );
}

function WorkspaceListView({
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
  onNewThread,
}: {
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
  onNewThread: () => void;
}) {
  const { theme } = useTheme();
  const [search, setSearch] = React.useState('');
  const filteredThreads = React.useMemo(
    () => filterRemoteThreads(threads, interactions, search, filter),
    [filter, interactions, search, threads]
  );
  const workspaceGroups = makeWorkspaceGroups(projects, filteredThreads, activeProjectId, organizeMode);
  const connected = desktopWork.data?.status === 'connected';

  return (
    <View style={styles.workspaceBrowser}>
      <View style={styles.connectedHeader}>
        <View style={[styles.workspaceIcon, { borderColor: theme.colors.border }]}>
          <Icon name="Monitor" size={16} color={theme.colors.text} />
        </View>
        <View style={styles.workspaceText}>
          <Text style={[styles.workspaceTitle, { color: theme.colors.text }]}>{connected ? machineName : 'Desktop app'}</Text>
          <Text style={[styles.workspaceSubtitle, { color: theme.colors.textMuted }]}>
            {connected ? 'Connected desktop' : 'Not connected'}
          </Text>
        </View>
        <View style={[styles.connectedDot, { backgroundColor: connected ? '#22c55e' : '#9ca3af' }]} />
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
          <TouchableOpacity accessibilityLabel="Clear remote thread search" onPress={() => setSearch('')}>
            <Icon name="X" size={15} color={theme.colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.remoteFilters}>
        {remoteThreadFilters.map((candidate) => (
          <TouchableOpacity
            key={candidate.value}
            accessibilityRole="button"
            accessibilityLabel={`Filter remote threads: ${candidate.label}`}
            accessibilityState={{ selected: filter === candidate.value }}
            onPress={() => onFilterChange(candidate.value)}
            style={[
              styles.remoteFilter,
              { backgroundColor: filter === candidate.value ? '#1d4ed8' : theme.colors.cardBackground },
            ]}
          >
            <Text style={{ color: theme.colors.text, fontSize: 11, fontWeight: '600' }}>
              {candidate.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
        {organizeMode === 'project' ? 'Projects' : 'Tasks'}
      </Text>

      {desktopWork.isLoading ? (
        <StatusBlock message="Loading desktop work..." />
      ) : desktopWork.isError || desktopWork.data?.status === 'unpaired' ? (
        <StatusBlock message={connectionMessage(desktopWork)} framed />
      ) : workspaceGroups.length === 0 || filteredThreads.length === 0 ? (
        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>No matching remote threads.</Text>
      ) : (
        workspaceGroups.map((workspace) => (
          <WorkspaceGroupView
            key={workspace.name}
            workspace={workspace}
            onOpenThread={onOpenThread}
            onNewThread={onNewThread}
          />
        ))
      )}
    </View>
  );
}

function StatusBlock({ message, framed = false }: { message: string; framed?: boolean }) {
  const { theme } = useTheme();

  return (
    <View style={[styles.statusBlock, framed ? { backgroundColor: theme.colors.cardBackground } : null]}>
      {!framed ? <ActivityIndicator color={theme.colors.text} size="small" /> : null}
      <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>{message}</Text>
    </View>
  );
}

function WorkspaceGroupView({
  workspace,
  onOpenThread,
  onNewThread,
}: {
  workspace: WorkspaceGroup;
  onOpenThread: (thread: DesktopThread) => void;
  onNewThread: () => void;
}) {
  const { theme } = useTheme();

  return (
    <View style={styles.workspaceGroup}>
      <View style={styles.workspaceGroupHeader}>
        <View style={styles.workspaceGroupTitle}>
          <Icon name="Database" size={19} color={theme.colors.text} />
          <Text style={[styles.workspaceGroupName, { color: theme.colors.text }]} numberOfLines={1}>
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
          <TouchableOpacity
            key={`${workspace.name}-${thread.sessionId}-${index}`}
            onPress={() => onOpenThread(thread)}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={`Open active session: ${thread.title}`}
            style={styles.threadRow}
          >
            <Text style={[styles.threadTitle, { color: theme.colors.text }]} numberOfLines={1}>
              {thread.title}
            </Text>
            {thread.state === 'running' || thread.activeRunId ? (
              <View style={[styles.threadStatus, { borderColor: theme.colors.border }]} accessibilityLabel="Active thread running" />
            ) : null}
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

const headerTitle = (view: DesktopView, selectedThread: DesktopThread | null): string => {
  if (view === 'newThread') {
    return 'New desktop thread';
  }
  if (view === 'session') {
    return selectedThread?.title ?? 'Desktop thread';
  }
  return 'Desktop';
};

const connectionMessage = (desktopWork: ReturnType<typeof useDesktopWorkStateQuery>): string => {
  if (desktopWork.error instanceof Error) {
    return desktopWork.error.message;
  }
  if (desktopWork.data?.status === 'unpaired') {
    return desktopWork.data.message;
  }
  return 'Connect the desktop app to view live work.';
};

type WorkspaceGroup = {
  name: string;
  expanded: boolean;
  threads: DesktopThread[];
};

type RemoteThreadFilter = 'all' | 'running' | 'needsInput' | 'completed' | 'archived';

const remoteThreadFilters: Array<{ value: RemoteThreadFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'needsInput', label: 'Needs input' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

const filterRemoteThreads = (
  threads: DesktopThread[],
  interactions: DesktopInteractionRequest[],
  search: string,
  filter: RemoteThreadFilter
): DesktopThread[] => {
  const query = search.trim().toLowerCase();
  const interactionThreadIds = new Set(
    interactions.map((interaction) => interaction.threadId).filter((id): id is string => Boolean(id))
  );
  return threads.filter((thread) => {
    const turns = thread.turns ?? [];
    const hasActiveTurn = turns.some(
      (turn) => turn.status === 'inProgress' || turn.status === 'queued'
    );
    const needsInput =
      interactionThreadIds.has(thread.id) ||
      turns.some((turn) =>
        turn.items.some(
          (item) => item.status === 'inProgress' && (item.type === 'approval' || item.type === 'toolCall')
        )
      );
    const matchesFilter =
      filter === 'all' ||
      (filter === 'running' && hasActiveTurn) ||
      (filter === 'needsInput' && needsInput) ||
      (filter === 'completed' && !hasActiveTurn && !needsInput && !thread.archived) ||
      (filter === 'archived' && thread.archived);
    if (!matchesFilter) return false;
    if (!query) return true;
    return `${thread.title} ${thread.objective} ${thread.lastMessage ?? ''} ${JSON.stringify(turns)}`
      .toLowerCase()
      .includes(query);
  });
};

const makeWorkspaceGroups = (
  projects: DesktopProject[],
  threads: DesktopThread[],
  activeProjectId: number | null,
  organizeMode: RemoteOrganizeMode
): WorkspaceGroup[] => {
  if (organizeMode !== 'project') {
    const sorted = [...threads].sort((left, right) => {
      if (organizeMode === 'chatsFirst' && left.taskMode !== right.taskMode) {
        if (left.taskMode === 'chat') return -1;
        if (right.taskMode === 'chat') return 1;
      }
      return right.updatedAt - left.updatedAt;
    });
    return sorted.length === 0 ? [] : [{ name: 'All tasks', expanded: true, threads: sorted }];
  }
  if (projects.length === 0) {
    return threads.length === 0 ? [] : [{ name: 'Desktop workspace', expanded: true, threads }];
  }

  const activeName = activeProjectName(projects, activeProjectId);
  return projects.map((project) => ({
    name: project.name,
    expanded: true,
    threads: project.name === activeName ? threads : [],
  }));
};

function RemoteMenu(props: {
  visible: boolean;
  organizeMode: RemoteOrganizeMode;
  onClose: () => void;
  onOrganize: (_mode: RemoteOrganizeMode) => void;
  onCloudTasks: () => void;
  onArchived: () => void;
  onSettings: () => void;
}) {
  const { theme } = useTheme();
  const organizeOptions: Array<{ mode: RemoteOrganizeMode; label: string; icon: 'Folder' | 'History' | 'MessagesCircle' }> = [
    { mode: 'project', label: 'By project', icon: 'Folder' },
    { mode: 'chronological', label: 'Chronological list', icon: 'History' },
    { mode: 'chatsFirst', label: 'Chats first', icon: 'MessagesCircle' },
  ];
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <TouchableOpacity activeOpacity={1} onPress={props.onClose} style={styles.menuBackdrop}>
        <View style={[styles.menuCard, { backgroundColor: theme.colors.cardBackground, borderColor: theme.colors.border }]}>
          <Text style={[styles.menuLabel, { color: theme.colors.textMuted }]}>Organize</Text>
          {organizeOptions.map((option) => (
            <MenuRow
              key={option.mode}
              icon={option.icon}
              label={option.label}
              selected={props.organizeMode === option.mode}
              onPress={() => props.onOrganize(option.mode)}
            />
          ))}
          <View style={[styles.menuDivider, { backgroundColor: theme.colors.border }]} />
          <Text style={[styles.menuLabel, { color: theme.colors.textMuted }]}>Manage</Text>
          <MenuRow icon="Cloud" label="Cloud tasks" onPress={props.onCloudTasks} />
          <MenuRow icon="Archive" label="Archived tasks" onPress={props.onArchived} />
          <MenuRow icon="Link" label="Add connection" onPress={props.onSettings} />
          <MenuRow icon="Settings" label="Settings" onPress={props.onSettings} />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

function RemoteTaskMenu(props: {
  visible: boolean;
  onClose: () => void;
  onChanges: () => void;
  onFiles: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <TouchableOpacity activeOpacity={1} onPress={props.onClose} style={styles.menuBackdrop}>
        <View style={[styles.menuCard, { backgroundColor: theme.colors.cardBackground, borderColor: theme.colors.border }]}>
          <Text style={[styles.menuLabel, { color: theme.colors.textMuted }]}>Desktop task</Text>
          <MenuRow icon="Activity" label="Changes" accessibilityLabel="Open remote changes" onPress={props.onChanges} />
          <MenuRow icon="Folder" label="Files" accessibilityLabel="Open remote files" onPress={props.onFiles} />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

function MenuRow(props: { icon: 'Folder' | 'History' | 'MessagesCircle' | 'Cloud' | 'Archive' | 'Link' | 'Settings' | 'Activity'; label: string; accessibilityLabel?: string; selected?: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={props.accessibilityLabel} onPress={props.onPress} style={styles.menuRow}>
      <View style={styles.menuCheck}>{props.selected ? <Icon name="Check" size={16} color={theme.colors.text} /> : null}</View>
      <Icon name={props.icon} size={19} color={theme.colors.text} />
      <Text style={[styles.menuText, { color: theme.colors.text }]}>{props.label}</Text>
    </TouchableOpacity>
  );
}

const activeProjectName = (projects: DesktopProject[], activeProjectId: number | null): string => {
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  return activeProject?.name ?? 'Desktop workspace';
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  remoteSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  remoteSearchInput: {
    flex: 1,
    paddingVertical: 10,
  },
  remoteFilters: {
    gap: 7,
    paddingTop: 9,
    paddingBottom: 4,
  },
  remoteFilter: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  headerSlot: {
    width: 44,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBackdrop: {
    flex: 1,
    alignItems: 'flex-end',
    paddingTop: 76,
    paddingRight: 14,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  menuCard: {
    width: 300,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 24,
  },
  menuLabel: { fontSize: 12, fontWeight: '600', paddingHorizontal: 12, paddingVertical: 7 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 42 },
  menuCheck: { width: 18, alignItems: 'center' },
  menuText: { fontSize: 17, flex: 1 },
  menuDivider: { height: StyleSheet.hairlineWidth, marginVertical: 8, marginHorizontal: 12 },
  workspaceBrowser: {
    gap: 4,
  },
  connectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 24,
  },
  workspaceIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workspaceText: {
    flex: 1,
    minWidth: 0,
  },
  workspaceTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  workspaceSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 14,
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  workspaceGroup: {
    marginBottom: 22,
  },
  workspaceGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  workspaceGroupTitle: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  workspaceGroupName: {
    fontSize: 18,
    fontWeight: '700',
  },
  newThreadBtn: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  threadRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 44,
    paddingLeft: 30,
    paddingRight: 4,
  },
  threadTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
  },
  threadStatus: {
    borderRadius: 8,
    borderWidth: 2,
    height: 16,
    width: 16,
  },
  emptyThreadText: {
    fontSize: 14,
    paddingLeft: 30,
    paddingTop: 10,
  },
  sessionSurface: {
    gap: 18,
    paddingTop: 10,
  },
  sessionBody: {
    fontSize: 18,
    lineHeight: 27,
  },
  promptForm: {
    alignItems: 'center',
    borderRadius: 26,
    flexDirection: 'row',
    gap: 14,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  promptInput: {
    flex: 1,
    fontSize: 17,
    minHeight: 40,
    paddingVertical: 0,
  },
  stopButton: {
    alignItems: 'center',
    backgroundColor: '#000000',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  statusBlock: {
    alignItems: 'center',
    borderRadius: 16,
    gap: 10,
    padding: 18,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    lineHeight: 18,
  },
});
