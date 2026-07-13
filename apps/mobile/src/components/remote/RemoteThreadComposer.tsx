import React from 'react';
import { TextInput, View } from 'react-native';

import { useTheme } from '../../contexts/ThemeContext';
import { useSendDesktopTurnMutation, type DesktopThread } from '../../hooks/api/desktopWork';
import { RemoteActionIcon, RemoteActionPill, RemoteErrorText } from './RemoteControls';

export function RemoteThreadComposer({ thread, running }: { thread: DesktopThread; running: boolean }) {
  const { theme } = useTheme();
  const [input, setInput] = React.useState('');
  const [behavior, setBehavior] = React.useState<'queue' | 'steer'>(running ? 'steer' : 'queue');
  const send = useSendDesktopTurnMutation();
  React.useEffect(() => setBehavior(running ? 'steer' : 'queue'), [running]);
  const submit = () => {
    const value = input.trim();
    if (!value || send.isPending) return;
    send.mutate({ threadId: thread.id, input: value, behavior }, { onSuccess: () => setInput('') });
  };
  return (
    <View style={{ gap: 8 }}>
      {running ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(['steer', 'queue'] as const).map((candidate) => (
            <RemoteActionPill key={candidate} label={candidate === 'steer' ? 'Steer current turn' : 'Queue follow-up'} selected={behavior === candidate} onPress={() => setBehavior(candidate)} />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 15, backgroundColor: theme.colors.cardBackground }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={running && behavior === 'steer' ? 'Steer the active turn' : 'Follow up remotely'}
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="Desktop follow up"
          multiline
          style={{ flex: 1, color: theme.colors.text, minHeight: 46, maxHeight: 130, paddingVertical: 10 }}
        />
        <RemoteActionIcon label="Send desktop follow up" icon="Send" disabled={!input.trim() || send.isPending} onPress={submit} />
      </View>
      {send.error instanceof Error ? <RemoteErrorText error={send.error} /> : null}
    </View>
  );
}
