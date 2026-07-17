import { useRouter, type Href } from 'expo-router';
import React from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { useTheme } from '../../contexts/ThemeContext';
import { CloudTasksScreen } from '../../screens/CloudTasksScreen';
import { SettingsScreen } from '../../screens/SettingsScreen';
import { RemoteFilesPanel } from './components/RemoteFilesPanel';
import { RemoteGitPanel } from './components/RemoteGitPanel';
import { RemoteInteractionCards } from './components/RemoteInteractionCards';
import { RemoteMenu, RemoteTaskMenu } from './components/remote-menus';
import {
  RemoteNewThreadComposer,
  type RemoteNewThreadPreset,
} from './components/RemoteNewThreadComposer';
import { RemotePairingScreen } from './components/RemotePairingScreen';
import { RemoteProjectSheet } from './components/RemoteProjectSheet';
import { RemoteReviewPanel } from './components/RemoteReviewPanel';
import { RemoteThreadContextMenu } from './components/remote-thread-context-menu';
import { RemoteThreadDetail } from './components/RemoteThreadDetail';
import { RemoteWorkspaceList } from './components/remote-workspace-list';
import {
  activeProjectName,
  type RemoteOrganizeMode,
  type RemoteThreadFilter,
} from './desktop-work-sections';
import { desktopWorkStyles as styles } from './desktop-work-styles';
import {
  useDesktopHostsQuery,
  useAllDesktopWorkStatesQuery,
  useDesktopWorkStateQuery,
  useSelectDesktopHostMutation,
  type DesktopThread,
  type DesktopEnvironmentWorkState,
} from './data/desktop-work';
import { syncRemoteAgentLiveActivity } from './live-activity';
import { recordRemoteQuickAction } from './quick-actions';

type RemoteRouteView = 'workspaces' | 'thread' | 'new' | 'files' | 'review' | 'git';

// eslint-disable-next-line complexity -- This route coordinates independent responsive panes, overlays, and navigation actions.
export function RemoteRouteScreen({
  view,
  threadId = null,
  preset = { taskMode: 'chat', projectId: null },
  onClose,
}: {
  view: RemoteRouteView;
  threadId?: string | null;
  preset?: RemoteNewThreadPreset;
  onClose: () => void;
}) {
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const inspectorView = view === 'files' || view === 'review' || view === 'git';
  const threePane = width >= 1180 && inspectorView && Boolean(threadId);
  const [workspaceMenuVisible, setWorkspaceMenuVisible] = React.useState(false);
  const [sessionMenuVisible, setSessionMenuVisible] = React.useState(false);
  const [pairingVisible, setPairingVisible] = React.useState(false);
  const [projectVisible, setProjectVisible] = React.useState(false);
  const [settingsVisible, setSettingsVisible] = React.useState(false);
  const [cloudTasksVisible, setCloudTasksVisible] = React.useState(false);
  const [organizeMode, setOrganizeMode] = React.useState<RemoteOrganizeMode>('project');
  const [filter, setFilter] = React.useState<RemoteThreadFilter>('all');
  const [contextThread, setContextThread] = React.useState<DesktopThread | null>(null);
  const desktopWork = useDesktopWorkStateQuery(true);
  const desktopHosts = useDesktopHostsQuery(true);
  const allDesktopWork = useAllDesktopWorkStatesQuery(view === 'workspaces' || wide);
  const selectDesktopHost = useSelectDesktopHostMutation();
  const connected: DesktopEnvironmentWorkState | null =
    desktopWork.data?.status === 'connected' ? desktopWork.data : null;
  const environments = allDesktopWork.data?.length ? allDesktopWork.data : connected ? [connected] : [];
  const threads = view === 'workspaces' || wide
    ? environments.flatMap((environment) => environment.threads)
    : connected?.threads ?? [];
  const projects = view === 'workspaces' || wide
    ? environments.flatMap((environment) => environment.projects)
    : connected?.projects ?? [];
  const interactions = view === 'workspaces' || wide
    ? environments.flatMap((environment) => environment.interactions)
    : connected?.interactions ?? [];
  const activeProjectId = connected?.activeProjectId ?? null;
  const machineName = connected?.machineName ?? 'Desktop';
  const selectedThread = threadId
    ? threads.find((thread) => thread.sessionId === threadId || thread.id === threadId) ?? null
    : null;
  const selectedProject = selectedThread?.projectId === null
    ? null
    : projects.find((project) => project.id === selectedThread?.projectId) ?? null;
  const activeWorkspace = selectedThread?.workspaceRoot
    ?? selectedProject?.workspaceRoots?.[0]
    ?? (projects.find((project) => project.id === activeProjectId) ?? projects[0])?.workspaceRoots?.[0]
    ?? null;

  React.useEffect(() => {
    if (!connected) return;
    void syncRemoteAgentLiveActivity(
      connected.threads,
      connected.interactions,
      connected.machineName ?? 'Desktop'
    );
  }, [connected]);

  const openThread = (thread: DesktopThread) => {
    void recordRemoteQuickAction(thread);
    const navigate = () => router.push({ pathname: '/remote/thread/[threadId]', params: { threadId: thread.sessionId } } as unknown as Href);
    if (thread.hostId && connected?.connection.baseUrl.toLowerCase() !== thread.hostId) {
      selectDesktopHost.mutate(thread.hostId, { onSuccess: navigate });
    } else navigate();
  };
  const replaceThread = (thread: DesktopThread) => {
    router.replace(
      {
        pathname: '/remote/thread/[threadId]',
        params: { threadId: thread.sessionId },
      } as unknown as Href
    );
  };
  const openNewThread = (nextPreset: RemoteNewThreadPreset) => {
    const navigate = () => router.push({
      pathname: '/remote/new',
      params: {
        taskMode: nextPreset.taskMode,
        ...(nextPreset.projectId === null ? {} : { projectId: String(nextPreset.projectId) }),
        ...(nextPreset.hostId ? { hostId: nextPreset.hostId } : {}),
      },
    } as unknown as Href);
    if (nextPreset.hostId && connected?.connection.baseUrl.toLowerCase() !== nextPreset.hostId) {
      selectDesktopHost.mutate(nextPreset.hostId, { onSuccess: navigate });
    } else navigate();
  };
  const openThreadTool = (tool: 'files' | 'review' | 'git') => {
    if (!selectedThread) return;
    router.push({
      pathname: `/remote/thread/[threadId]/${tool}`,
      params: { threadId: selectedThread.sessionId },
    } as unknown as Href);
  };
  const goBack = () => {
    if (view === 'workspaces' || wide) onClose();
    else if (inspectorView && threadId) {
      router.replace(
        {
          pathname: '/remote/thread/[threadId]',
          params: { threadId },
        } as unknown as Href
      );
    } else router.replace('/remote' as Href);
  };
  const chooseDesktopHost = () => {
    const hosts = desktopHosts.data ?? [];
    if (hosts.length < 2) {
      Alert.alert('Remote Mac', 'Pair another Mac with Add connection before switching.');
      return;
    }
    Alert.alert('Remote Mac', 'Choose a saved Mac', [
      ...hosts.map((host) => ({
        text: host.name,
        onPress: () => selectDesktopHost.mutate(host.id, { onSuccess: () => router.replace('/remote' as Href) }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const workspaceList = (
    <RemoteWorkspaceList
      desktopWork={desktopWork}
      machineName={environments.length > 1 ? `${environments.length} paired Macs` : machineName}
      projects={projects}
      threads={threads}
      interactions={interactions}
      activeProjectId={activeProjectId}
      organizeMode={organizeMode}
      filter={filter}
      onFilterChange={setFilter}
      onOpenThread={openThread}
      onLongPressThread={setContextThread}
      onNewThread={openNewThread}
    />
  );

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
        <View style={styles.headerSlot}>
          <TouchableOpacity
            onPress={goBack}
            style={[styles.headerBtn, { backgroundColor: theme.colors.cardBackground }]}
            accessibilityRole="button"
            accessibilityLabel={view === 'workspaces' ? 'Back to chat' : 'Back to Remote'}
          >
            <Icon name="ChevronLeft" size={20} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.colors.text }]} numberOfLines={1}>
            {routeTitle(view, selectedThread)}
          </Text>
          {selectedThread && view !== 'workspaces' ? (
            <Text style={[styles.headerSubtitle, { color: theme.colors.textMuted }]} numberOfLines={1}>
              {selectedProject?.name ?? activeProjectName(projects, activeProjectId)} · {machineName}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerSlot}>
          {view === 'workspaces' || view === 'thread' ? (
            <TouchableOpacity
              onPress={() => view === 'workspaces' ? setWorkspaceMenuVisible(true) : setSessionMenuVisible(true)}
              style={[styles.headerBtn, { backgroundColor: theme.colors.cardBackground }]}
              accessibilityRole="button"
              accessibilityLabel={view === 'workspaces' ? 'Open Remote menu' : 'Open remote task menu'}
            >
              <Icon name="MoreHorizontal" size={20} color={theme.colors.text} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={routeStyles.columns}>
        {wide ? (
          <ScrollView
            style={[routeStyles.sidebar, { borderRightColor: theme.colors.border }]}
            contentContainerStyle={routeStyles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {workspaceList}
          </ScrollView>
        ) : null}
        <ScrollView
          style={routeStyles.detail}
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[routeStyles.scrollContent, wide && routeStyles.wideDetailContent]}
          showsVerticalScrollIndicator={false}
        >
          {!wide && view === 'workspaces' ? workspaceList : null}
          {view === 'new' ? (
            <RemoteNewThreadComposer
              machineName={machineName}
              projects={projects}
              preset={preset}
              onStarted={replaceThread}
            />
          ) : selectedThread && (view === 'thread' || threePane) ? (
            <View style={{ gap: 12 }}>
              <RemoteInteractionCards
                interactions={interactions.filter(
                  (interaction) => !interaction.threadId || interaction.threadId === selectedThread.sessionId
                )}
              />
              <RemoteThreadDetail
                summary={selectedThread}
                workspace={activeWorkspace}
                hasPendingInteraction={interactions.some(
                  (interaction) => !interaction.threadId || interaction.threadId === selectedThread.sessionId
                )}
                onDeleted={() => router.replace('/remote' as Href)}
                onForked={replaceThread}
                onOpenFiles={() => openThreadTool('files')}
                onOpenReview={() => openThreadTool('review')}
                onOpenGit={() => openThreadTool('git')}
                onNewThread={() => openNewThread({ taskMode: selectedThread.taskMode === 'chat' ? 'chat' : 'code', projectId: activeProjectId })}
              />
            </View>
          ) : selectedThread && view === 'files' ? (
            <RemoteFilesPanel workspace={activeWorkspace} />
          ) : selectedThread && view === 'review' ? (
              <RemoteReviewPanel workspace={activeWorkspace} threadId={selectedThread.id} />
          ) : selectedThread && view === 'git' && selectedThread.taskMode === 'code' ? (
            <RemoteGitPanel workspace={activeWorkspace} />
          ) : selectedThread && view === 'git' ? (
            <Text style={{ color: theme.colors.textMuted }}>
              Git actions are available for Remote code threads.
            </Text>
          ) : view !== 'workspaces' ? (
            <Text style={{ color: theme.colors.textMuted }}>
              {desktopWork.isLoading
                ? 'Loading Remote thread…'
                : 'The Remote thread is no longer available.'}
            </Text>
          ) : wide ? (
            <View style={routeStyles.emptyDetail}>
              <Icon name="Monitor" size={30} color={theme.colors.textMuted} />
              <Text style={{ color: theme.colors.text, fontSize: 19, fontWeight: '700' }}>Remote workspace</Text>
              <Text style={{ color: theme.colors.textMuted, textAlign: 'center' }}>
                Choose a thread to keep its workspace visible alongside the conversation.
              </Text>
            </View>
          ) : null}
        </ScrollView>
        {threePane && selectedThread ? (
          <ScrollView
            style={[routeStyles.inspector, { borderLeftColor: theme.colors.border }]}
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={routeStyles.inspectorContent}
          >
            {view === 'files' ? <RemoteFilesPanel workspace={activeWorkspace} /> : null}
            {view === 'review' ? <RemoteReviewPanel workspace={activeWorkspace} threadId={selectedThread.id} /> : null}
            {view === 'git' && selectedThread.taskMode === 'code' ? <RemoteGitPanel workspace={activeWorkspace} /> : null}
            {view === 'git' && selectedThread.taskMode !== 'code' ? (
              <Text style={{ color: theme.colors.textMuted }}>Git actions are available for Remote code threads.</Text>
            ) : null}
          </ScrollView>
        ) : null}
      </View>

      <RemoteMenu
        visible={workspaceMenuVisible}
        organizeMode={organizeMode}
        onClose={() => setWorkspaceMenuVisible(false)}
        onOrganize={(mode) => { setOrganizeMode(mode); setWorkspaceMenuVisible(false); }}
        onCloudTasks={() => { setWorkspaceMenuVisible(false); setCloudTasksVisible(true); }}
        onArchived={() => { setFilter('archived'); setWorkspaceMenuVisible(false); }}
        onAddConnection={() => { setWorkspaceMenuVisible(false); setPairingVisible(true); }}
        onSwitchConnection={() => { setWorkspaceMenuVisible(false); chooseDesktopHost(); }}
        onAddProject={() => { setWorkspaceMenuVisible(false); setProjectVisible(true); }}
        onSettings={() => { setWorkspaceMenuVisible(false); setSettingsVisible(true); }}
      />
      <RemoteTaskMenu
        visible={sessionMenuVisible}
        onClose={() => setSessionMenuVisible(false)}
        onChanges={() => { setSessionMenuVisible(false); openThreadTool('review'); }}
        onFiles={() => { setSessionMenuVisible(false); openThreadTool('files'); }}
        onGit={() => { setSessionMenuVisible(false); openThreadTool('git'); }}
        codeMode={selectedThread?.taskMode === 'code'}
      />
      <RemotePairingScreen visible={pairingVisible} onClose={() => setPairingVisible(false)} onPaired={() => void desktopWork.refetch()} />
      <RemoteProjectSheet
        visible={projectVisible}
        onClose={() => setProjectVisible(false)}
        onCreated={(project) => openNewThread({ taskMode: 'code', projectId: project.id })}
      />
      <RemoteThreadContextMenu thread={contextThread} onClose={() => setContextThread(null)} onOpen={(thread) => { setContextThread(null); openThread(thread); }} />
      <SettingsScreen visible={settingsVisible} initialSection="apps" onClose={() => setSettingsVisible(false)} />
      <CloudTasksScreen visible={cloudTasksVisible} onClose={() => setCloudTasksVisible(false)} onCreate={() => { setCloudTasksVisible(false); openNewThread({ taskMode: 'code', projectId: activeProjectId }); }} />
    </SafeAreaView>
  );
}

const routeTitle = (view: RemoteRouteView, thread: DesktopThread | null) => {
  if (view === 'files') return 'Files';
  if (view === 'review') return 'Review';
  if (view === 'git') return 'Git';
  if (view === 'new') return 'New Remote task';
  if (view === 'thread') return thread?.title ?? 'Remote thread';
  return 'Remote';
};

const routeStyles = StyleSheet.create({
  columns: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 340, flexGrow: 0, flexShrink: 0, borderRightWidth: StyleSheet.hairlineWidth },
  detail: { flex: 1 },
  inspector: { width: 390, flexGrow: 0, flexShrink: 0, borderLeftWidth: StyleSheet.hairlineWidth },
  inspectorContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  wideDetailContent: { width: '100%', maxWidth: 920, alignSelf: 'center', paddingHorizontal: 28 },
  emptyDetail: { minHeight: 440, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
});
