import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Icon } from '../../../components/Icon';
import { useTheme } from '../../../contexts/ThemeContext';
import { desktopWorkStyles as styles } from '../desktop-work-styles';
import {
  useDesktopThreadActionMutation,
  useRenameDesktopThreadMutation,
  type DesktopThread,
} from '../data/desktop-work';

interface RemoteThreadContextMenuProps {
  thread: DesktopThread | null;
  onClose: () => void;
  onOpen: (thread: DesktopThread) => void;
}

export function RemoteThreadContextMenu({
  thread,
  onClose,
  onOpen,
}: RemoteThreadContextMenuProps) {
  const { theme } = useTheme();
  const action = useDesktopThreadActionMutation();
  const rename = useRenameDesktopThreadMutation();
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState('');

  React.useEffect(() => {
    setEditing(false);
    setTitle(thread?.title ?? '');
  }, [thread]);

  if (!thread) return null;

  const archiveLabel = thread.archived ? 'Unarchive' : 'Archive';
  const saveRename = () => {
    const nextTitle = title.trim();
    if (!nextTitle || rename.isPending) return;
    rename.mutate({ threadId: thread.id, title: nextTitle }, { onSuccess: onClose });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close remote thread actions"
        style={styles.threadContextBackdrop}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => undefined}
          style={[
            styles.threadPreviewCard,
            { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
          ]}
        >
          <Text style={[styles.threadPreviewTitle, { color: theme.colors.text }]} numberOfLines={2}>
            {thread.title}
          </Text>
          <Text
            style={[styles.threadPreviewBody, { color: theme.colors.textMuted }]}
            numberOfLines={8}
          >
            {thread.lastMessage || thread.objective || 'No thread preview is available yet.'}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Open active session: ${thread.title}`}
            onPress={() => onOpen(thread)}
            style={styles.threadPreviewOpen}
          >
            <Text style={{ color: theme.colors.text, fontWeight: '600' }}>Open thread</Text>
            <Icon name="ArrowUpRight" size={18} color={theme.colors.text} />
          </TouchableOpacity>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={1}
          onPress={() => undefined}
          style={[
            styles.threadContextMenu,
            { backgroundColor: theme.colors.cardBackground, borderColor: theme.colors.border },
          ]}
        >
          {editing ? (
            <View style={styles.threadRenameRow}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                autoFocus
                accessibilityLabel="Rename remote thread"
                returnKeyType="done"
                onSubmitEditing={saveRename}
                style={[
                  styles.threadRenameInput,
                  { color: theme.colors.text, borderColor: theme.colors.border },
                ]}
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Save remote thread name"
                onPress={saveRename}
                disabled={!title.trim() || rename.isPending}
                style={styles.threadContextActionIcon}
              >
                {rename.isPending ? (
                  <ActivityIndicator size="small" color={theme.colors.text} />
                ) : (
                  <Icon name="Check" size={20} color={theme.colors.text} />
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <ThreadContextAction
              icon="SquarePen"
              label="Rename"
              onPress={() => setEditing(true)}
            />
          )}
          <ThreadContextAction
            icon="Archive"
            label={archiveLabel}
            destructive={!thread.archived}
            pending={action.isPending}
            onPress={() =>
              action.mutate(
                { threadId: thread.id, action: thread.archived ? 'unarchive' : 'archive' },
                { onSuccess: onClose }
              )
            }
          />
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function ThreadContextAction({
  icon,
  label,
  destructive = false,
  pending = false,
  onPress,
}: {
  icon: 'SquarePen' | 'Archive';
  label: string;
  destructive?: boolean;
  pending?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const color = destructive ? '#ef4444' : theme.colors.text;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={pending}
      style={styles.threadContextAction}
    >
      {pending ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Icon name={icon} size={20} color={color} />
      )}
      <Text style={[styles.threadContextActionText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}
