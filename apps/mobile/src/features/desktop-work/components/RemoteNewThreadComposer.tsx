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
  useStartDesktopThreadMutation,
  type DesktopProject,
  type DesktopThread,
} from '../data/desktop-work';
import { useRemoteComposerModel } from '../useRemoteComposerModel';
import { RemoteErrorText } from './RemoteControls';
import { RemoteModelSelector } from './RemoteModelSelector';

export type RemoteNewThreadPreset = {
  taskMode: 'chat' | 'code';
  projectId: number | null;
};

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
  const [input, setInput] = React.useState('');
  const [taskMode, setTaskMode] = React.useState<'chat' | 'code'>(preset.taskMode);
  const [projectId, setProjectId] = React.useState<number | null>(preset.projectId);
  const [preparing, setPreparing] = React.useState(false);
  const startThread = useStartDesktopThreadMutation();
  const model = useRemoteComposerModel();
  const attachments = usePromptAttachments();
  const voice = usePromptVoice();
  const project = projects.find((candidate) => candidate.id === projectId) ?? projects[0] ?? null;
  const workspace = taskMode === 'code' ? project?.workspaceRoots?.[0] ?? null : null;
  const gitStatus = useDesktopGitStatusQuery(workspace, taskMode === 'code');
  const branch = gitStatus.data?.branch ?? (gitStatus.isLoading ? 'Loading branch…' : 'Current branch');
  const disabled = preparing || startThread.isPending;

  React.useEffect(() => {
    setTaskMode(preset.taskMode);
    setProjectId(preset.projectId);
  }, [preset.projectId, preset.taskMode]);

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
      startThread.mutate(
        {
          input: value,
          taskMode,
          projectId: taskMode === 'code' ? project?.id ?? null : null,
          modelId: model.effectiveModelId,
          reasoningEffort: model.selectedEffort,
          attachmentIds,
        },
        {
          onSuccess: (result) => {
            setInput('');
            attachments.clearAttachments();
            onStarted(result.thread);
          },
          onSettled: () => setPreparing(false),
        }
      );
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
        onInputChange={setInput}
        onAddAttachments={addAttachments}
        onDictation={voice.isListening ? () => void voice.acceptListening() : startDictation}
        onSubmit={() => void submit()}
      />
      {taskMode === 'code' && !project ? (
        <Text selectable style={{ color: '#fca5a5' }}>Choose a project before starting Code work.</Text>
      ) : null}
      {startThread.error instanceof Error ? <RemoteErrorText error={startThread.error} /> : null}
    </View>
  );
}

function DestinationSelectors({
  machineName,
  taskMode,
  projectName,
  branch,
  branchLoading,
  onChooseDestination,
}: {
  machineName: string;
  taskMode: 'chat' | 'code';
  projectName: string | null;
  branch: string;
  branchLoading: boolean;
  onChooseDestination: () => void;
}) {
  return (
    <>
      <ComposerSelector
        icon="Monitor"
        label={machineName}
        accessibilityLabel="Select Remote Mac"
        onPress={() => Alert.alert('Mac', machineName)}
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
            label="Work locally"
            accessibilityLabel="Select Remote execution target"
            onPress={() => Alert.alert('Start in', 'Work locally on the paired Mac is selected.')}
          />
          <ComposerSelector
            icon="GitPullRequest"
            label={branch}
            accessibilityLabel="Select Remote branch"
            loading={branchLoading}
            onPress={() => Alert.alert('Branch', branch)}
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
  onInputChange,
  onAddAttachments,
  onDictation,
  onSubmit,
}: {
  input: string;
  disabled: boolean;
  listening: boolean;
  model: ReturnType<typeof useRemoteComposerModel>;
  onInputChange: (input: string) => void;
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
