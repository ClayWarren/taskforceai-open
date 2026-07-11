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
import {
  useDesktopWorkStateQuery,
  useSendDesktopTurnMutation,
  useStartDesktopThreadMutation,
  type DesktopPendingChange,
  type DesktopProject,
  type DesktopThread,
  type DesktopWorkState,
} from '../hooks/api/desktopWork';

interface DesktopWorkScreenProps {
  visible: boolean;
  onClose: () => void;
}

type DesktopView = 'workspaces' | 'session' | 'newThread';

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
    pendingChanges: connected?.pendingChanges ?? [],
    activeProjectId: connected?.activeProjectId ?? null,
    machineName: connected?.machineName ?? 'Desktop',
    selectedThread,
  };
};

export function DesktopWorkScreen({ visible, onClose }: DesktopWorkScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [activeView, setActiveView] = React.useState<DesktopView>('workspaces');
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(null);
  const [createdThread, setCreatedThread] = React.useState<DesktopThread | null>(null);
  const desktopWork = useDesktopWorkStateQuery(visible);
  const workState = desktopWork.data;
  const { threads, projects, pendingChanges, activeProjectId, machineName, selectedThread } =
    desktopWorkView(workState, selectedThreadId, createdThread);
  const title = headerTitle(activeView, selectedThread);

  React.useEffect(() => {
    if (!visible) {
      return;
    }
    setActiveView('workspaces');
    setSelectedThreadId(null);
    setCreatedThread(null);
  }, [visible]);

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

          <View style={styles.headerSlot} />
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
            <SessionView thread={selectedThread} pendingChanges={pendingChanges} />
          ) : (
            <WorkspaceListView
              desktopWork={desktopWork}
              machineName={machineName}
              projects={projects}
              threads={threads}
              activeProjectId={activeProjectId}
              onOpenThread={openThread}
              onNewThread={() => setActiveView('newThread')}
            />
          )}
        </ScrollView>
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

function SessionView({
  thread,
  pendingChanges,
}: {
  thread: DesktopThread;
  pendingChanges: DesktopPendingChange[];
}) {
  const { theme } = useTheme();
  const [followUp, setFollowUp] = React.useState('');
  const sendTurn = useSendDesktopTurnMutation();
  const submit = () => {
    const input = followUp.trim();
    if (!input || sendTurn.isPending) {
      return;
    }
    sendTurn.mutate(
      { threadId: thread.sessionId, input },
      {
        onSuccess: () => setFollowUp(''),
      }
    );
  };

  return (
    <View style={styles.sessionSurface}>
      <Text style={[styles.sessionBody, { color: theme.colors.text }]}>
        {thread.lastMessage ?? thread.objective ?? 'This desktop thread is synced from the paired local app.'}
      </Text>

      <WorkingSpace thread={thread} pendingChanges={pendingChanges} />

      <View style={styles.activityRow}>
        <Icon name="Monitor" size={16} color={theme.colors.textMuted} />
        <Text style={[styles.activityText, { color: theme.colors.textMuted }]} numberOfLines={1}>
          {activityText(thread)}
        </Text>
        <Icon name="ChevronRight" size={15} color={theme.colors.textMuted} />
      </View>

      <View style={[styles.diffPill, { backgroundColor: theme.colors.cardBackground }]}>
        <Text style={[styles.diffText, { color: theme.colors.textMuted }]}>
          {pendingChangeCountText(pendingChanges.length)}
        </Text>
      </View>

      <View style={[styles.promptForm, { backgroundColor: theme.colors.cardBackground }]}>
        <Icon name="Plus" size={22} color={theme.colors.text} />
        <TextInput
          value={followUp}
          onChangeText={setFollowUp}
          placeholder="Follow up"
          placeholderTextColor={theme.colors.textMuted}
          style={[styles.promptInput, { color: theme.colors.text }]}
          returnKeyType="send"
          onSubmitEditing={submit}
          accessibilityLabel="Desktop follow up"
        />
        <Icon name="Mic" size={20} color={theme.colors.text} />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Send desktop follow up"
          onPress={submit}
          disabled={!followUp.trim() || sendTurn.isPending}
          style={styles.stopButton}
        >
          {sendTurn.isPending ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Icon name="Square" size={16} color="#ffffff" />
          )}
        </TouchableOpacity>
      </View>
      {sendTurn.error instanceof Error ? <Text style={styles.errorText}>{sendTurn.error.message}</Text> : null}
    </View>
  );
}

function WorkingSpace({
  thread,
  pendingChanges,
}: {
  thread: DesktopThread;
  pendingChanges: DesktopPendingChange[];
}) {
  const { theme } = useTheme();

  return (
    <View style={[styles.workingPanel, { backgroundColor: theme.colors.cardBackground }]}>
      <View style={styles.workingPanelHeader}>
        <View style={styles.workspaceGroupTitle}>
          <Icon name="Monitor" size={16} color={theme.colors.textMuted} />
          <Text style={[styles.workingPanelTitle, { color: theme.colors.text }]}>Working space</Text>
        </View>
        <Text style={[styles.workspaceSubtitle, { color: theme.colors.textMuted }]}>{thread.state}</Text>
      </View>

      {pendingChanges.length === 0 ? (
        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>No local diff yet.</Text>
      ) : (
        pendingChanges.slice(0, 3).map((change) => (
          <View
            key={`${change.type}-${change.entityId}-${change.id ?? change.createdAt}`}
            style={styles.workingFileRow}
          >
            <Icon name="Database" size={15} color={theme.colors.textMuted} />
            <Text style={[styles.workingFileText, { color: theme.colors.text }]} numberOfLines={1}>
              {formatPendingChange(change)}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

function WorkspaceListView({
  desktopWork,
  machineName,
  projects,
  threads,
  activeProjectId,
  onOpenThread,
  onNewThread,
}: {
  desktopWork: ReturnType<typeof useDesktopWorkStateQuery>;
  machineName: string;
  projects: DesktopProject[];
  threads: DesktopThread[];
  activeProjectId: number | null;
  onOpenThread: (thread: DesktopThread) => void;
  onNewThread: () => void;
}) {
  const { theme } = useTheme();
  const workspaceGroups = makeWorkspaceGroups(projects, threads, activeProjectId);
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

      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Projects</Text>

      {desktopWork.isLoading ? (
        <StatusBlock message="Loading desktop work..." />
      ) : desktopWork.isError || desktopWork.data?.status === 'unpaired' ? (
        <StatusBlock message={connectionMessage(desktopWork)} framed />
      ) : workspaceGroups.length === 0 ? (
        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>No desktop projects or threads yet.</Text>
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

const activityText = (thread: DesktopThread): string => {
  if (thread.activeRunId) {
    return `Active run ${thread.activeRunId}`;
  }
  const runCount = thread.runIds?.length ?? 0;
  return `${runCount} run${runCount === 1 ? '' : 's'} recorded`;
};

const pendingChangeCountText = (count: number): string =>
  count === 0 ? 'No pending changes' : `${count} pending change${count === 1 ? '' : 's'}`;

type WorkspaceGroup = {
  name: string;
  expanded: boolean;
  threads: DesktopThread[];
};

const makeWorkspaceGroups = (
  projects: DesktopProject[],
  threads: DesktopThread[],
  activeProjectId: number | null
): WorkspaceGroup[] => {
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

const activeProjectName = (projects: DesktopProject[], activeProjectId: number | null): string => {
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  return activeProject?.name ?? 'Desktop workspace';
};

const formatPendingChange = (change: DesktopPendingChange): string => {
  const operation = change.operation ? `${change.operation} ` : '';
  return `${operation}${change.type} ${change.entityId}`.trim();
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
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
  workingPanel: {
    borderRadius: 18,
    gap: 12,
    padding: 14,
  },
  workingPanelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  workingPanelTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  workingFileRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  workingFileText: {
    flex: 1,
    fontSize: 13,
  },
  activityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  activityText: {
    flex: 1,
    fontSize: 14,
  },
  diffPill: {
    alignSelf: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  diffText: {
    fontSize: 13,
    fontWeight: '600',
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
