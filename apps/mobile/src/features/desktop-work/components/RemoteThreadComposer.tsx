import React from 'react';
import { ActivityIndicator, Alert, TextInput, TouchableOpacity, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { AttachmentsBar } from '../../../components/PromptInput/AttachmentsBar';
import { useTheme } from '../../../contexts/ThemeContext';
import { usePromptAttachments } from '../../../hooks/usePromptAttachments';
import { usePromptVoice } from '../../../hooks/usePromptVoice';
import {
  useDesktopSkillsQuery,
  useSendDesktopTurnMutation,
  type DesktopThread,
} from '../data/desktop-work';
import {
  createRemoteOutboxId,
  enqueueRemoteTurn,
  readRemoteTurnOutbox,
  removeRemoteTurn,
  useRemoteComposerDraft,
  type RemoteTurnOutboxItem,
} from '../remote-composer-storage';
import { useRemoteComposerModel } from '../useRemoteComposerModel';
import { RemoteComposerControls } from './RemoteComposerControls';
import {
  RemoteActionIcon,
  RemoteActionPill,
  RemoteErrorText,
  RemoteStatusText,
} from './RemoteControls';
import { RemoteComposerSuggestions, type RemoteComposerCommand } from './RemoteComposerSuggestions';
import { RemoteModelSelector } from './RemoteModelSelector';

type ComposerBehavior = 'queue' | 'steer';

const remoteComposerCommands = ({
  clear,
  onOpenFiles,
  onOpenReview,
  onOpenGit,
  onNewThread,
}: {
  clear: () => void;
  onOpenFiles?: () => void;
  onOpenReview?: () => void;
  onOpenGit?: () => void;
  onNewThread?: () => void;
}): RemoteComposerCommand[] => {
  const commands: RemoteComposerCommand[] = [];
  if (onOpenFiles) commands.push({ name: '/files', description: 'Browse workspace files', icon: 'Folder', run: onOpenFiles });
  if (onOpenReview) commands.push({ name: '/review', description: 'Review workspace changes', icon: 'GitPullRequest', run: onOpenReview });
  if (onOpenGit) commands.push({ name: '/git', description: 'Commit, sync, and open a pull request', icon: 'GitPullRequest', run: onOpenGit });
  if (onNewThread) commands.push({ name: '/new', description: 'Start another Remote task', icon: 'SquarePen', run: onNewThread });
  commands.push({ name: '/clear', description: 'Clear the composer', icon: 'X', run: clear });
  return commands;
};

const RemoteBehaviorToggle = ({
  behavior,
  steerDisabled,
  onChange,
}: {
  behavior: ComposerBehavior;
  steerDisabled: boolean;
  onChange: (behavior: ComposerBehavior) => void;
}) => (
  <View style={{ flexDirection: 'row', gap: 6 }}>
    {(['steer', 'queue'] as const).map((candidate) => (
      <RemoteActionPill
        key={candidate}
        label={candidate === 'steer' ? 'Steer current turn' : 'Queue follow-up'}
        selected={behavior === candidate}
        disabled={candidate === 'steer' && steerDisabled}
        onPress={() => onChange(candidate)}
      />
    ))}
  </View>
);

const RemoteVoiceButton = ({
  disabled,
  voice,
  onStart,
  color,
}: {
  disabled: boolean;
  voice: ReturnType<typeof usePromptVoice>;
  onStart: () => void;
  color: string;
}) =>
  voice.isListening ? (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Cancel Remote dictation"
        onPress={() => void voice.cancelListening()}
        style={{ padding: 8 }}
      >
        <Icon name="X" size={20} color="#fca5a5" />
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Finish Remote dictation"
        onPress={() => void voice.acceptListening()}
        style={{ padding: 8 }}
      >
        <Icon name="Check" size={20} color={color} />
      </TouchableOpacity>
    </>
  ) : (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Dictate Remote follow up"
      onPress={onStart}
      disabled={disabled}
      style={{ padding: 8 }}
    >
      <Icon name="Mic" size={21} color={color} />
    </TouchableOpacity>
  );

export function RemoteThreadComposer({
  thread,
  running,
  workspace = null,
  onOpenFiles,
  onOpenReview,
  onOpenGit,
  onNewThread,
}: {
  thread: DesktopThread;
  running: boolean;
  workspace?: string | null;
  onOpenFiles?: () => void;
  onOpenReview?: () => void;
  onOpenGit?: () => void;
  onNewThread?: () => void;
}) {
  const { theme } = useTheme();
  const composer = useRemoteComposerDraft(`thread:${thread.id}`);
  const { draft, setInput, setPlanMode, setPermissionProfile, clear } = composer;
  const input = draft.input;
  const [behavior, setBehavior] = React.useState<ComposerBehavior>(running ? 'steer' : 'queue');
  const [preparing, setPreparing] = React.useState(false);
  const [queuedCount, setQueuedCount] = React.useState(0);
  const [storageError, setStorageError] = React.useState<Error | null>(null);
  const delivering = React.useRef(false);
  const autoRetryTarget = React.useRef<string | null>(null);
  const send = useSendDesktopTurnMutation();
  const model = useRemoteComposerModel(running);
  const skills = useDesktopSkillsQuery();
  const attachmentsState = usePromptAttachments();
  const voice = usePromptVoice();
  const effectiveBehavior =
    running && attachmentsState.attachments.length > 0 ? 'queue' : behavior;
  const commands = remoteComposerCommands({
    clear,
    onOpenFiles,
    onOpenReview,
    onOpenGit,
    onNewThread,
  });

  const refreshQueuedCount = React.useCallback(async () => {
    const items = await readRemoteTurnOutbox(thread.id);
    setQueuedCount(items.length);
    return items;
  }, [thread.id]);

  const retryQueued = React.useCallback(async () => {
    if (delivering.current) return;
    const [item] = await refreshQueuedCount();
    if (!item) return;
    delivering.current = true;
    send.mutate(
      {
        threadId: item.threadId,
        input: item.input,
        behavior: 'queue',
        modelId: item.modelId,
        reasoningEffort: item.reasoningEffort,
        attachmentIds: item.attachmentIds,
        planMode: item.planMode,
        permissionProfile: item.permissionProfile,
        clientMessageId: item.id,
      },
      {
        onSuccess: () => {
          void removeRemoteTurn(item.id).then(async () => {
            delivering.current = false;
            const remaining = await refreshQueuedCount();
            if (remaining.length > 0) void retryQueued();
          }).catch((error: unknown) => {
            delivering.current = false;
            setStorageError(
              error instanceof Error ? error : new Error('The Remote outbox could not be updated.')
            );
          });
        },
        onError: () => {
          delivering.current = false;
          void refreshQueuedCount();
        },
      }
    );
  }, [refreshQueuedCount, send]);

  React.useEffect(() => setBehavior(running ? 'steer' : 'queue'), [running]);
  React.useEffect(() => {
    if (running && attachmentsState.attachments.length > 0) setBehavior('queue');
  }, [attachmentsState.attachments.length, running]);
  React.useEffect(() => {
    void refreshQueuedCount();
  }, [refreshQueuedCount]);
  React.useEffect(() => {
    if (autoRetryTarget.current === thread.id) return;
    autoRetryTarget.current = thread.id;
    void retryQueued();
  }, [retryQueued, thread.id]);

  const addAttachments = () => {
    Alert.alert('Add Attachment', 'Choose a source', [
      { text: 'Camera', onPress: () => void attachmentsState.takePhoto() },
      { text: 'Photo Library', onPress: () => void attachmentsState.pickImages() },
      { text: 'Browse Files', onPress: () => void attachmentsState.pickDocuments() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const submit = async () => {
    const value = input.trim();
    if (!value || send.isPending || preparing) return;
    setPreparing(true);
    try {
      const attachmentIds =
        effectiveBehavior === 'queue'
          ? await Promise.all(
              attachmentsState.attachments.map(attachmentsState.uploadAttachment)
            )
          : [];
      if (effectiveBehavior === 'steer') {
        send.mutate(
          { threadId: thread.id, input: value, behavior: 'steer' },
          {
            onSuccess: () => {
              clear();
              attachmentsState.clearAttachments();
            },
            onSettled: () => setPreparing(false),
          }
        );
        return;
      }
      const item: RemoteTurnOutboxItem = {
        id: createRemoteOutboxId(),
        threadId: thread.id,
        input: value,
        modelId: model.effectiveModelId,
        reasoningEffort: model.selectedEffort,
        attachmentIds,
        planMode: draft.planMode,
        permissionProfile: draft.permissionProfile,
        createdAt: Date.now(),
      };
      await enqueueRemoteTurn(item);
      setStorageError(null);
      clear();
      attachmentsState.clearAttachments();
      setPreparing(false);
      await refreshQueuedCount();
      void retryQueued();
    } catch (error) {
      setPreparing(false);
      const failure = error instanceof Error ? error : new Error('The follow-up could not be saved.');
      setStorageError(failure);
      Alert.alert('Remote Error', failure.message);
    }
  };

  const startDictation = () => {
    void voice.startListening((transcript) => {
      setInput((current) => `${current}${current.trim() ? ' ' : ''}${transcript}`);
    });
  };

  return (
    <View style={{ gap: 8 }}>
      {running ? (
        <RemoteBehaviorToggle
          behavior={effectiveBehavior}
          steerDisabled={attachmentsState.attachments.length > 0}
          onChange={setBehavior}
        />
      ) : null}
      <RemoteComposerControls
        planMode={draft.planMode}
        permissionProfile={draft.permissionProfile}
        onPlanModeChange={(planMode) => {
          setPlanMode(planMode);
          setBehavior('queue');
        }}
        onPermissionProfileChange={(permissionProfile) => {
          setPermissionProfile(permissionProfile);
          setBehavior('queue');
        }}
      />
      <AttachmentsBar
        attachments={attachmentsState.attachments}
        onRemove={attachmentsState.removeAttachment}
        errorColor="#fca5a5"
      />
      <View style={{ gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: theme.colors.cardBackground }}>
        <RemoteComposerSuggestions
          input={input}
          workspace={workspace}
          commands={commands}
          skills={skills.data?.skills ?? []}
          onInputChange={setInput}
        />
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={
            running && effectiveBehavior === 'steer'
              ? 'Steer the active turn'
              : 'Follow up remotely'
          }
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="Desktop follow up"
          multiline
          style={{ color: theme.colors.text, minHeight: 46, maxHeight: 130, paddingVertical: 8 }}
        />
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 7 }}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Add files to Remote follow up"
            onPress={addAttachments}
            disabled={preparing || send.isPending}
            style={{ padding: 8 }}
          >
            <Icon name="Plus" size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <RemoteModelSelector
            options={model.options}
            loading={model.modelQuery.isLoading}
            selectedModelId={model.effectiveModelId}
            selectedEffort={model.selectedEffort}
            onModelChange={(modelId) => {
              if (model.selectModel(modelId)) setBehavior('queue');
            }}
            onEffortChange={(effort) => {
              if (model.selectEffort(effort)) setBehavior('queue');
            }}
          />
          <RemoteVoiceButton
            disabled={preparing || send.isPending}
            voice={voice}
            onStart={startDictation}
            color={theme.colors.text}
          />
          {preparing || send.isPending ? (
            <ActivityIndicator size="small" color={theme.colors.text} />
          ) : (
            <RemoteActionIcon
              label="Send desktop follow up"
              icon="Send"
              disabled={!input.trim()}
              onPress={() => void submit()}
            />
          )}
        </View>
      </View>
      {queuedCount > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <RemoteStatusText
              text={`${queuedCount} ${queuedCount === 1 ? 'follow-up' : 'follow-ups'} saved in the Remote outbox.`}
            />
          </View>
          <RemoteActionPill label="Retry" onPress={() => void retryQueued()} />
        </View>
      ) : null}
      {send.error instanceof Error ? <RemoteErrorText error={send.error} /> : null}
      {storageError ? <RemoteErrorText error={storageError} /> : null}
    </View>
  );
}
