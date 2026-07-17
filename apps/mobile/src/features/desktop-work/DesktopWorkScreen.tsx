import React from 'react';
import { Alert, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { useTheme } from '../../contexts/ThemeContext';
import { CloudTasksScreen } from '../../screens/CloudTasksScreen';
import { SettingsScreen } from '../../screens/SettingsScreen';
import { RemoteFilesSheet } from './components/RemoteFilesPanel';
import { RemoteInteractionCards } from './components/RemoteInteractionCards';
import { RemoteMenu, RemoteTaskMenu } from './components/remote-menus';
import {
  RemoteNewThreadComposer,
  type RemoteNewThreadPreset,
} from './components/RemoteNewThreadComposer';
import { RemotePairingScreen } from './components/RemotePairingScreen';
import { RemoteProjectSheet } from './components/RemoteProjectSheet';
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
  useDesktopWorkStateQuery,
  useDesktopHostsQuery,
  useSelectDesktopHostMutation,
  type DesktopThread,
  type DesktopWorkState,
} from './data/desktop-work';
import { syncRemoteAgentLiveActivity } from './live-activity';

interface DesktopWorkScreenProps {
  visible: boolean;
  initialThreadId?: string | null;
  onClose: () => void;
  onDismiss?: () => void;
}

type DesktopView = 'workspaces' | 'session' | 'newThread';
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

export function DesktopWorkScreen({
  visible,
  initialThreadId = null,
  onClose,
  onDismiss,
}: DesktopWorkScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [activeView, setActiveView] = React.useState<DesktopView>('workspaces');
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(null);
  const [createdThread, setCreatedThread] = React.useState<DesktopThread | null>(null);
  const [newThreadPreset, setNewThreadPreset] = React.useState<RemoteNewThreadPreset>({
    taskMode: 'chat',
    projectId: null,
  });
  const [workspaceMenuVisible, setWorkspaceMenuVisible] = React.useState(false);
  const [pairingVisible, setPairingVisible] = React.useState(false);
  const [projectVisible, setProjectVisible] = React.useState(false);
  const [settingsVisible, setSettingsVisible] = React.useState(false);
  const [cloudTasksVisible, setCloudTasksVisible] = React.useState(false);
  const [sessionMenuVisible, setSessionMenuVisible] = React.useState(false);
  const [sessionSheet, setSessionSheet] = React.useState<RemoteSessionSheet>(null);
  const [organizeMode, setOrganizeMode] = React.useState<RemoteOrganizeMode>('project');
  const [filter, setFilter] = React.useState<RemoteThreadFilter>('all');
  const [contextThread, setContextThread] = React.useState<DesktopThread | null>(null);
  const desktopWork = useDesktopWorkStateQuery(visible);
  const desktopHosts = useDesktopHostsQuery(visible);
  const selectDesktopHost = useSelectDesktopHostMutation();
  const workState = desktopWork.data;
  const {
    threads,
    projects,
    interactions,
    activeProjectId,
    machineName,
    selectedThread,
  } = desktopWorkView(workState, selectedThreadId, createdThread);
  const title = headerTitle(activeView, selectedThread);
  const activeWorkspace = (
    projects.find((project) => project.id === activeProjectId) ?? projects[0]
  )?.workspaceRoots?.[0] ?? null;

  React.useEffect(() => {
    if (!visible) {
      return;
    }
    setActiveView(initialThreadId ? 'session' : 'workspaces');
    setSelectedThreadId(initialThreadId);
    setCreatedThread(null);
    setPairingVisible(false);
    setProjectVisible(false);
    setSettingsVisible(false);
    setCloudTasksVisible(false);
    setSessionMenuVisible(false);
    setSessionSheet(null);
    setContextThread(null);
  }, [initialThreadId, visible]);

  React.useEffect(() => {
    if (workState?.status !== 'connected') return;
    void syncRemoteAgentLiveActivity(
      workState.threads,
      workState.interactions,
      workState.machineName
    );
  }, [workState]);

  const openThread = (thread: DesktopThread) => {
    setSelectedThreadId(thread.sessionId);
    setActiveView('session');
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
        onPress: () => {
          selectDesktopHost.mutate(host.id, {
            onSuccess: () => {
              setSelectedThreadId(null);
              setCreatedThread(null);
              setActiveView('workspaces');
            },
          });
        },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onDismiss={onDismiss}
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
          <View style={styles.headerSlot}>
            <TouchableOpacity
              onPress={activeView === 'workspaces' ? onClose : () => setActiveView('workspaces')}
              style={[styles.headerBtn, { backgroundColor: theme.colors.cardBackground }]}
              accessibilityRole="button"
              accessibilityLabel={
                activeView === 'workspaces' ? 'Back to chat' : 'Back to desktop workspaces'
              }
            >
              <Icon name="ChevronLeft" size={20} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            {activeView === 'session' && selectedThread ? (
              <Text
                style={[styles.headerSubtitle, { color: theme.colors.textMuted }]}
                numberOfLines={1}
              >
                {activeProjectName(projects, activeProjectId)} · {machineName}
              </Text>
            ) : null}
          </View>

          <View style={styles.headerSlot}>
            {activeView === 'workspaces' ||
            (activeView === 'session' && selectedThread?.taskMode === 'code') ? (
              <TouchableOpacity
                onPress={() =>
                  activeView === 'workspaces'
                    ? setWorkspaceMenuVisible(true)
                    : setSessionMenuVisible(true)
                }
                style={[styles.headerBtn, { backgroundColor: theme.colors.cardBackground }]}
                accessibilityRole="button"
                accessibilityLabel={
                  activeView === 'workspaces' ? 'Open Remote menu' : 'Open remote task menu'
                }
              >
                <Icon name="MoreHorizontal" size={20} color={theme.colors.text} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 28),
          }}
          showsVerticalScrollIndicator={false}
        >
          {activeView === 'newThread' ? (
            <RemoteNewThreadComposer
              machineName={machineName}
              projects={projects}
              preset={newThreadPreset}
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
                workspace={activeWorkspace}
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
                onChangesVisibleChange={(nextVisible) =>
                  setSessionSheet(nextVisible ? 'changes' : null)
                }
              />
            </View>
          ) : (
            <RemoteWorkspaceList
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
              onLongPressThread={setContextThread}
              onNewThread={(preset) => {
                setNewThreadPreset(preset);
                setActiveView('newThread');
              }}
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
            setCloudTasksVisible(true);
          }}
          onArchived={() => {
            setFilter('archived');
            setWorkspaceMenuVisible(false);
          }}
          onAddConnection={() => {
            setWorkspaceMenuVisible(false);
            setPairingVisible(true);
          }}
          onSwitchConnection={() => {
            setWorkspaceMenuVisible(false);
            chooseDesktopHost();
          }}
          onAddProject={() => {
            setWorkspaceMenuVisible(false);
            setProjectVisible(true);
          }}
          onSettings={() => {
            setWorkspaceMenuVisible(false);
            setSettingsVisible(true);
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
          workspace={activeWorkspace}
          onVisibleChange={(nextVisible) => setSessionSheet(nextVisible ? 'files' : null)}
        />
        <RemotePairingScreen
          visible={pairingVisible}
          onClose={() => setPairingVisible(false)}
          onPaired={() => void desktopWork.refetch()}
        />
        <RemoteProjectSheet
          visible={projectVisible}
          onClose={() => setProjectVisible(false)}
          onCreated={(project) => {
            setNewThreadPreset({ taskMode: 'code', projectId: project.id });
            setActiveView('newThread');
          }}
        />
        <RemoteThreadContextMenu
          thread={contextThread}
          onClose={() => setContextThread(null)}
          onOpen={(thread) => {
            setContextThread(null);
            openThread(thread);
          }}
        />
        <SettingsScreen
          visible={settingsVisible}
          initialSection="apps"
          onClose={() => setSettingsVisible(false)}
        />
        <CloudTasksScreen
          visible={cloudTasksVisible}
          onClose={() => setCloudTasksVisible(false)}
          onCreate={() => {
            setCloudTasksVisible(false);
            setNewThreadPreset({ taskMode: 'code', projectId: activeProjectId });
            setActiveView('newThread');
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const headerTitle = (view: DesktopView, selectedThread: DesktopThread | null): string => {
  if (view === 'newThread') {
    return '';
  }
  if (view === 'session') {
    return selectedThread?.title ?? 'Desktop thread';
  }
  return 'Desktop';
};
