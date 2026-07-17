import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Icon } from '../../../components/Icon';
import { AttachmentsBar } from '../../../components/PromptInput/AttachmentsBar';
import { useTheme } from '../../../contexts/ThemeContext';
import { usePromptAttachments } from '../../../hooks/usePromptAttachments';
import { usePromptVoice } from '../../../hooks/usePromptVoice';
import {
  useDesktopGitStatusQuery,
  useDesktopGitBranchesQuery,
  useDesktopGitWorktreesQuery,
  useDesktopHostsQuery,
  useSelectDesktopHostMutation,
  useAttachDesktopWorkspaceMutation,
  useCreateDesktopWorktreeMutation,
  useDesktopSkillsQuery,
  useStartDesktopThreadMutation,
  type DesktopProject,
  type DesktopSkill,
  type DesktopThread,
} from '../data/desktop-work';
import {
  createRemoteOutboxId,
  enqueueRemoteThreadCreation,
  readRemoteThreadCreationOutbox,
  removeRemoteThreadCreation,
  useRemoteComposerDraft,
  type RemotePermissionProfile,
  type RemoteThreadCreationOutboxItem,
} from '../remote-composer-storage';
import { useRemoteComposerModel } from '../useRemoteComposerModel';
import { RemoteComposerControls } from './RemoteComposerControls';
import { RemoteErrorText } from './RemoteControls';
import { RemoteComposerSuggestions } from './RemoteComposerSuggestions';
import { RemoteModelSelector } from './RemoteModelSelector';

export type RemoteNewThreadPreset = {
  taskMode: 'chat' | 'code';
  projectId: number | null;
  hostId?: string | null;
};

const resolveRemoteDestination = (
  projects: DesktopProject[],
  projectId: number | null,
  taskMode: 'chat' | 'code',
  selectedWorkspace: string | null
) => {
  const project = projects.find((candidate) => candidate.id === projectId) ?? projects[0] ?? null;
  const workspace = taskMode === 'code' ? project?.workspaceRoots?.[0] ?? null : null;
  return { project, workspace, effectiveWorkspace: selectedWorkspace ?? workspace };
};

const remoteBranchLabel = (
  worktreeBranch: string | null | undefined,
  statusBranch: string | null | undefined,
  loading: boolean
) => worktreeBranch ?? statusBranch ?? (loading ? 'Loading branch…' : 'Current branch');

export function RemoteNewThreadComposer({
  machineName,
  projects,
  preset,
  onStarted,
}: {
  machineName: string;
  projects: DesktopProject[];
  preset: RemoteNewThreadPreset;
  onStarted: (thread: DesktopThread) => void;
}) {
  const { theme } = useTheme();
  const composer = useRemoteComposerDraft(`new:${machineName}`);
  const { draft, setInput, setPlanMode, setPermissionProfile, clear } = composer;
  const input = draft.input;
  const [taskMode, setTaskMode] = React.useState<'chat' | 'code'>(preset.taskMode);
  const [projectId, setProjectId] = React.useState<number | null>(preset.projectId);
  const [selectedWorkspace, setSelectedWorkspace] = React.useState<string | null>(null);
  const [preparing, setPreparing] = React.useState(false);
  const [queuedCount, setQueuedCount] = React.useState(0);
  const delivering = React.useRef(false);
  const autoRetryHost = React.useRef<string | null | undefined>(undefined);
  const startThread = useStartDesktopThreadMutation();
  const model = useRemoteComposerModel();
  const skills = useDesktopSkillsQuery();
  const attachments = usePromptAttachments();
  const voice = usePromptVoice();
  const { project, workspace, effectiveWorkspace } = resolveRemoteDestination(
    projects,
    projectId,
    taskMode,
    selectedWorkspace
  );
  const gitStatus = useDesktopGitStatusQuery(effectiveWorkspace, taskMode === 'code');
  const branches = useDesktopGitBranchesQuery(workspace, taskMode === 'code');
  const worktrees = useDesktopGitWorktreesQuery(workspace, taskMode === 'code');
  const hosts = useDesktopHostsQuery(true);
  const selectHost = useSelectDesktopHostMutation();
  const attachWorkspace = useAttachDesktopWorkspaceMutation();
  const createWorktree = useCreateDesktopWorktreeMutation();
  const selectedWorktree = worktrees.data?.worktrees.find(
    (candidate) => candidate.path === effectiveWorkspace
  );
  const branch = remoteBranchLabel(
    selectedWorktree?.branch,
    gitStatus.data?.branch,
    gitStatus.isLoading
  );
  const disabled = [
    preparing,
    startThread.isPending,
    selectHost.isPending,
    createWorktree.isPending,
  ].some(Boolean);
  const hostId = preset.hostId
    ?? hosts.data?.find(
      (host) => host.session.machineName === machineName || host.name === machineName
    )?.id
    ?? null;

  const refreshQueuedCount = React.useCallback(async () => {
    const items = await readRemoteThreadCreationOutbox(hostId);
    setQueuedCount(items.length);
    return items;
  }, [hostId]);

  const deliverQueued = React.useCallback((item: RemoteThreadCreationOutboxItem) => {
    if (delivering.current) return;
    delivering.current = true;
    setPreparing(true);
    startThread.mutate(
      {
        input: item.input,
        taskMode: item.taskMode,
        projectId: item.projectId,
        workspaceRoot: item.workspaceRoot,
        modelId: item.modelId,
        reasoningEffort: item.reasoningEffort,
        attachmentIds: item.attachmentIds,
        planMode: item.planMode,
        permissionProfile: item.permissionProfile,
        hostId: item.hostId,
        clientMessageId: item.id,
      },
      {
        onSuccess: (result) => {
          void removeRemoteThreadCreation(item.id).then(() => {
            clear();
            attachments.clearAttachments();
            void refreshQueuedCount();
            onStarted(result.thread);
          });
        },
        onSettled: () => {
          delivering.current = false;
          setPreparing(false);
        },
      }
    );
  }, [attachments, clear, onStarted, refreshQueuedCount, startThread]);

  React.useEffect(() => {
    setTaskMode(preset.taskMode);
    setProjectId(preset.projectId);
    setSelectedWorkspace(null);
  }, [preset.projectId, preset.taskMode]);

  React.useEffect(() => {
    setSelectedWorkspace(null);
  }, [projectId]);

  React.useEffect(() => {
    if (autoRetryHost.current === hostId) return;
    autoRetryHost.current = hostId;
    void refreshQueuedCount().then(([item]) => {
      if (item) deliverQueued(item);
    });
  }, [deliverQueued, hostId, refreshQueuedCount]);

  const chooseHost = () => {
    const savedHosts = hosts.data ?? [];
    if (savedHosts.length <= 1) {
      Alert.alert('Remote Mac', machineName, [
        { text: 'Add another Mac', onPress: () => Alert.alert('Add connection', 'Use Add connection from the Remote menu to pair another Mac.') },
        { text: 'Close', style: 'cancel' },
      ]);
      return;
    }
    Alert.alert('Remote Mac', 'Choose where this task will run', [
      ...savedHosts.map((host) => ({
        text: host.name,
        onPress: () => selectHost.mutate(host.id),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const chooseWorktree = () => {
    if (!project || !workspace) return;
    const availableWorktrees = worktrees.data?.worktrees ?? [];
    const availableBranches = (branches.data?.branches ?? []).slice(0, 8);
    Alert.alert('Branch or worktree', 'Run in an existing worktree or create a new one.', [
      ...availableWorktrees.map((candidate) => ({
        text: `${candidate.branch ?? 'Detached'} · ${shortPath(candidate.path)}`,
        onPress: () => {
          if (!project.workspaceRoots?.includes(candidate.path)) {
            attachWorkspace.mutate({
              projectId: project.id,
              workspaceRoots: project.workspaceRoots ?? [],
              workspace: candidate.path,
            });
          }
          setSelectedWorkspace(candidate.path);
        },
      })),
      ...availableBranches.map((candidate) => ({
        text: `New worktree from ${candidate.name}`,
        onPress: () => {
          createWorktree.mutate(
            {
              projectId: project.id,
              workspaceRoots: project.workspaceRoots ?? [],
              workspace,
              branch: `codex/mobile-${Date.now()}`,
              baseRef: candidate.name,
            },
            { onSuccess: (result) => setSelectedWorkspace(result.worktree.path) }
          );
        },
      })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const chooseDestination = () => {
    Alert.alert('Start in', 'Choose where this task belongs', [
      {
        text: 'Chats',
        onPress: () => {
          setTaskMode('chat');
          setProjectId(null);
        },
      },
      ...projects.map((candidate) => ({
        text: candidate.name,
        onPress: () => {
          setTaskMode('code' as const);
          setProjectId(candidate.id);
        },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const addAttachments = () => {
    Alert.alert('Add Attachment', 'Choose a source', [
      { text: 'Camera', onPress: () => void attachments.takePhoto() },
      { text: 'Photo Library', onPress: () => void attachments.pickImages() },
      { text: 'Browse Files', onPress: () => void attachments.pickDocuments() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const submit = async () => {
    const value = input.trim();
    if (!value || disabled || (taskMode === 'code' && !project)) return;
    setPreparing(true);
    try {
      const attachmentIds = await Promise.all(
        attachments.attachments.map(attachments.uploadAttachment)
      );
      const item: RemoteThreadCreationOutboxItem = {
        id: createRemoteOutboxId(),
        hostId,
        input: value,
        taskMode,
        projectId: taskMode === 'code' ? project?.id ?? null : null,
        workspaceRoot: taskMode === 'code' ? selectedWorkspace ?? workspace : null,
        modelId: model.effectiveModelId,
        reasoningEffort: model.selectedEffort,
        attachmentIds,
        planMode: draft.planMode,
        permissionProfile: draft.permissionProfile,
        createdAt: Date.now(),
      };
      await enqueueRemoteThreadCreation(item);
      clear();
      attachments.clearAttachments();
      setPreparing(false);
      await refreshQueuedCount();
      deliverQueued(item);
    } catch (error) {
      setPreparing(false);
      Alert.alert(
        'Attachment Error',
        error instanceof Error ? error.message : 'The selected files could not be uploaded.'
      );
    }
  };

  const startDictation = () => {
    void voice.startListening((transcript) => {
      setInput((current) => `${current}${current.trim() ? ' ' : ''}${transcript}`);
    });
  };

  return (
    <View style={{ minHeight: 560, flex: 1, justifyContent: 'flex-end', gap: 12, paddingBottom: 8 }}>
      <DestinationSelectors
        machineName={machineName}
        taskMode={taskMode}
        projectName={project?.name ?? null}
        branch={branch}
        branchLoading={gitStatus.isLoading}
        workspaceLabel={
          effectiveWorkspace && effectiveWorkspace !== workspace
            ? shortPath(effectiveWorkspace)
            : 'Work locally'
        }
        onChooseHost={chooseHost}
        onChooseWorktree={chooseWorktree}
        onChooseDestination={chooseDestination}
      />

      <AttachmentsBar
        attachments={attachments.attachments}
        onRemove={attachments.removeAttachment}
        errorColor="#fca5a5"
      />
      <ComposerInput
        input={input}
        disabled={disabled}
        listening={voice.isListening}
        model={model}
        skills={skills.data?.skills ?? []}
        workspace={effectiveWorkspace}
        planMode={draft.planMode}
        permissionProfile={draft.permissionProfile}
        onInputChange={setInput}
        onPlanModeChange={setPlanMode}
        onPermissionProfileChange={setPermissionProfile}
        onAddAttachments={addAttachments}
        onDictation={voice.isListening ? () => void voice.acceptListening() : startDictation}
        onSubmit={() => void submit()}
      />
      {taskMode === 'code' && !project ? (
        <Text selectable style={{ color: '#fca5a5' }}>Choose a project before starting Code work.</Text>
      ) : null}
      {startThread.error instanceof Error ? <RemoteErrorText error={startThread.error} /> : null}
      {queuedCount > 0 ? (
        <Text selectable style={{ color: theme.colors.textMuted, fontSize: 12 }}>
          {queuedCount} {queuedCount === 1 ? 'task is' : 'tasks are'} saved and will start when this Mac reconnects.
        </Text>
      ) : null}
    </View>
  );
}

function DestinationSelectors({
  machineName,
  taskMode,
  projectName,
  branch,
  branchLoading,
  workspaceLabel,
  onChooseHost,
  onChooseWorktree,
  onChooseDestination,
}: {
  machineName: string;
  taskMode: 'chat' | 'code';
  projectName: string | null;
  branch: string;
  branchLoading: boolean;
  workspaceLabel: string;
  onChooseHost: () => void;
  onChooseWorktree: () => void;
  onChooseDestination: () => void;
}) {
  return (
    <>
      <ComposerSelector
        icon="Monitor"
        label={machineName}
        accessibilityLabel="Select Remote Mac"
        onPress={onChooseHost}
      />
      <ComposerSelector
        icon={taskMode === 'chat' ? 'MessagesCircle' : 'Folder'}
        label={taskMode === 'chat' ? 'Chats' : projectName ?? 'Choose a project'}
        accessibilityLabel="Select Remote destination"
        onPress={onChooseDestination}
      />
      {taskMode === 'code' ? (
        <>
          <ComposerSelector
            icon="HardDrive"
            label={workspaceLabel}
            accessibilityLabel="Select Remote execution target"
            onPress={onChooseWorktree}
          />
          <ComposerSelector
            icon="GitPullRequest"
            label={branch}
            accessibilityLabel="Select Remote branch"
            loading={branchLoading}
            onPress={onChooseWorktree}
          />
        </>
      ) : null}
    </>
  );
}

function ComposerInput({
  input,
  disabled,
  listening,
  model,
  skills,
  workspace,
  planMode,
  permissionProfile,
  onInputChange,
  onPlanModeChange,
  onPermissionProfileChange,
  onAddAttachments,
  onDictation,
  onSubmit,
}: {
  input: string;
  disabled: boolean;
  listening: boolean;
  model: ReturnType<typeof useRemoteComposerModel>;
  skills: DesktopSkill[];
  workspace?: string | null;
  planMode: boolean;
  permissionProfile: RemotePermissionProfile;
  onInputChange: (input: string) => void;
  onPlanModeChange: (enabled: boolean) => void;
  onPermissionProfileChange: (profile: RemotePermissionProfile) => void;
  onAddAttachments: () => void;
  onDictation: () => void;
  onSubmit: () => void;
}) {
  const { theme } = useTheme();
  const canSubmit = Boolean(input.trim()) && !disabled;
  return (
    <View
      style={{
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 22,
        borderCurve: 'continuous',
        backgroundColor: theme.colors.cardBackground,
      }}
    >
      <RemoteComposerControls
        planMode={planMode}
        permissionProfile={permissionProfile}
        onPlanModeChange={onPlanModeChange}
        onPermissionProfileChange={onPermissionProfileChange}
      />
      <RemoteComposerSuggestions
        input={input}
        workspace={workspace}
        skills={skills}
        commands={[{ name: '/clear', description: 'Clear the composer', icon: 'X', run: () => onInputChange('') }]}
        onInputChange={onInputChange}
      />
      <TextInput
        value={input}
        onChangeText={onInputChange}
        placeholder="Ask TaskForceAI"
        placeholderTextColor={theme.colors.textMuted}
        accessibilityLabel="New desktop thread prompt"
        multiline
        autoFocus
        style={{ color: theme.colors.text, minHeight: 46, maxHeight: 130, paddingVertical: 8 }}
      />
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 5 }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Add files to new Remote task"
          disabled={disabled}
          onPress={onAddAttachments}
          style={{ padding: 8 }}
        >
          <Icon name="Plus" size={23} color={theme.colors.text} />
        </TouchableOpacity>
        <Icon name="Shield" size={21} color="#f97316" />
        <View style={{ flex: 1 }} />
        <RemoteModelSelector
          options={model.options}
          loading={model.modelQuery.isLoading}
          selectedModelId={model.effectiveModelId}
          selectedEffort={model.selectedEffort}
          onModelChange={model.selectModel}
          onEffortChange={model.selectEffort}
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={listening ? 'Finish Remote dictation' : 'Dictate new Remote task'}
          disabled={disabled}
          onPress={onDictation}
          style={{ padding: 8 }}
        >
          <Icon name={listening ? 'Check' : 'Mic'} size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Start desktop thread"
          accessibilityState={{ disabled: !canSubmit }}
          disabled={!canSubmit}
          onPress={onSubmit}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: canSubmit ? theme.colors.primary : theme.colors.border,
          }}
        >
          {disabled ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Icon name="Send" size={19} color="#ffffff" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ComposerSelector({
  icon,
  label,
  accessibilityLabel,
  loading = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  accessibilityLabel: string;
  loading?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 20 }}
    >
      <Icon name={icon} size={22} color={theme.colors.textMuted} />
      <Text style={{ flex: 1, color: theme.colors.text, fontSize: 17 }} numberOfLines={1}>
        {label}
      </Text>
      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.textMuted} />
      ) : (
        <Icon name="ChevronUp" size={17} color={theme.colors.textMuted} />
      )}
    </TouchableOpacity>
  );
}

const shortPath = (path: string): string => {
  const segments = path.split('/').filter(Boolean);
  return segments.slice(-2).join('/') || path;
};
