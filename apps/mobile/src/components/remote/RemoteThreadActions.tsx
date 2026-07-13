import React from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';

import { useTheme } from '../../contexts/ThemeContext';
import {
  useDesktopThreadActionMutation,
  useInterruptDesktopTurnMutation,
  useRenameDesktopThreadMutation,
  type DesktopThread,
  type DesktopThreadAction,
} from '../../hooks/api/desktopWork';
import { RemoteActionIcon, RemoteActionPill } from './RemoteControls';

export function RemoteThreadActions({ thread, running, onDeleted, onForked }: {
  thread: DesktopThread;
  running: boolean;
  onDeleted: () => void;
  onForked: (thread: DesktopThread) => void;
}) {
  const { theme } = useTheme();
  const action = useDesktopThreadActionMutation();
  const interrupt = useInterruptDesktopTurnMutation();
  const rename = useRenameDesktopThreadMutation();
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(thread.title);

  const runAction = (nextAction: DesktopThreadAction) => {
    const perform = () => action.mutate({ threadId: thread.id, action: nextAction }, {
      onSuccess: (result) => {
        if (nextAction === 'delete') onDeleted();
        if (nextAction === 'fork' && result && 'thread' in result && result.thread && typeof result.thread === 'object') {
          const fork = result.thread as DesktopThread;
          onForked({ ...fork, sessionId: fork.id ?? fork.sessionId });
        }
      },
    });
    if (nextAction === 'delete' || nextAction === 'cancel') {
      Alert.alert(
        nextAction === 'delete' ? 'Delete remote thread?' : 'Cancel remote thread?',
        nextAction === 'delete' ? 'This permanently removes the thread from the paired desktop.' : 'This stops active work and marks the thread canceled.',
        [{ text: 'Keep', style: 'cancel' }, { text: nextAction === 'delete' ? 'Delete' : 'Cancel thread', style: 'destructive', onPress: perform }]
      );
      return;
    }
    perform();
  };

  if (editing) {
    return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={title} onChangeText={setTitle} autoFocus accessibilityLabel="Remote thread title" style={{ flex: 1, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }} />
        <RemoteActionIcon label="Save remote thread title" icon="Check" onPress={() => rename.mutate({ threadId: thread.id, title }, { onSuccess: () => setEditing(false) })} />
        <RemoteActionIcon label="Cancel renaming" icon="X" onPress={() => setEditing(false)} />
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {running ? <RemoteActionPill label="Stop turn" icon="Square" onPress={() => interrupt.mutate({ threadId: thread.id })} /> : thread.state === 'paused' || thread.state === 'canceled' ? <RemoteActionPill label="Resume" icon="Play" onPress={() => runAction('resume')} /> : null}
      <RemoteActionPill label="Rename" icon="SquarePen" onPress={() => setEditing(true)} />
      <RemoteActionPill label="Fork" icon="Copy" onPress={() => runAction('fork')} />
      <RemoteActionPill label={thread.archived ? 'Unarchive' : 'Archive'} icon="Folder" onPress={() => runAction(thread.archived ? 'unarchive' : 'archive')} />
      <RemoteActionPill label="Cancel thread" icon="X" onPress={() => runAction('cancel')} />
      <RemoteActionPill label="Delete" icon="Trash2" onPress={() => runAction('delete')} danger />
    </ScrollView>
  );
}
