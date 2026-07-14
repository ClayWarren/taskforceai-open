import React from 'react';
import { ActivityIndicator, Alert, TextInput, TouchableOpacity, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { AttachmentsBar } from '../../../components/PromptInput/AttachmentsBar';
import { useTheme } from '../../../contexts/ThemeContext';
import { usePromptAttachments } from '../../../hooks/usePromptAttachments';
import { usePromptVoice } from '../../../hooks/usePromptVoice';
import { useSendDesktopTurnMutation, type DesktopThread } from '../data/desktop-work';
import { useRemoteComposerModel } from '../useRemoteComposerModel';
import { RemoteActionIcon, RemoteActionPill, RemoteErrorText } from './RemoteControls';
import { RemoteModelSelector } from './RemoteModelSelector';

type ComposerBehavior = 'queue' | 'steer';

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

export function RemoteThreadComposer({ thread, running }: { thread: DesktopThread; running: boolean }) {
  const { theme } = useTheme();
  const [input, setInput] = React.useState('');
  const [behavior, setBehavior] = React.useState<ComposerBehavior>(running ? 'steer' : 'queue');
  const [preparing, setPreparing] = React.useState(false);
  const send = useSendDesktopTurnMutation();
  const model = useRemoteComposerModel(running);
  const attachmentsState = usePromptAttachments();
  const voice = usePromptVoice();
  const effectiveBehavior =
    running && attachmentsState.attachments.length > 0 ? 'queue' : behavior;

  React.useEffect(() => setBehavior(running ? 'steer' : 'queue'), [running]);
  React.useEffect(() => {
    if (running && attachmentsState.attachments.length > 0) setBehavior('queue');
  }, [attachmentsState.attachments.length, running]);

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
      send.mutate(
        {
          threadId: thread.id,
          input: value,
          behavior: effectiveBehavior,
          modelId: effectiveBehavior === 'queue' ? model.effectiveModelId : null,
          reasoningEffort: effectiveBehavior === 'queue' ? model.selectedEffort : null,
          attachmentIds: effectiveBehavior === 'queue' ? attachmentIds : [],
        },
        {
          onSuccess: () => {
            setInput('');
            attachmentsState.clearAttachments();
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
    <View style={{ gap: 8 }}>
      {running ? (
        <RemoteBehaviorToggle
          behavior={effectiveBehavior}
          steerDisabled={attachmentsState.attachments.length > 0}
          onChange={setBehavior}
        />
      ) : null}
      <AttachmentsBar
        attachments={attachmentsState.attachments}
        onRemove={attachmentsState.removeAttachment}
        errorColor="#fca5a5"
      />
      <View style={{ gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: theme.colors.cardBackground }}>
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
      {send.error instanceof Error ? <RemoteErrorText error={send.error} /> : null}
    </View>
  );
}
