import { Modal, Text, TouchableOpacity, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { useTheme } from '../../../contexts/ThemeContext';
import type { RemoteOrganizeMode } from '../desktop-work-sections';
import { desktopWorkStyles as styles } from '../desktop-work-styles';

interface RemoteMenuProps {
  visible: boolean;
  organizeMode: RemoteOrganizeMode;
  onClose: () => void;
  onOrganize: (_mode: RemoteOrganizeMode) => void;
  onCloudTasks: () => void;
  onArchived: () => void;
  onAddConnection: () => void;
  onSettings: () => void;
}

export function RemoteMenu(props: RemoteMenuProps) {
  const { theme } = useTheme();
  const organizeOptions: Array<{
    mode: RemoteOrganizeMode;
    label: string;
    icon: 'Folder' | 'History' | 'MessagesCircle';
  }> = [
    { mode: 'project', label: 'By project', icon: 'Folder' },
    { mode: 'chronological', label: 'Chronological list', icon: 'History' },
    { mode: 'chatsFirst', label: 'Chats first', icon: 'MessagesCircle' },
  ];
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <TouchableOpacity activeOpacity={1} onPress={props.onClose} style={styles.menuBackdrop}>
        <View
          style={[
            styles.menuCard,
            { backgroundColor: theme.colors.cardBackground, borderColor: theme.colors.border },
          ]}
        >
          <Text style={[styles.menuLabel, { color: theme.colors.textMuted }]}>Organize</Text>
          {organizeOptions.map((option) => (
            <MenuRow
              key={option.mode}
              icon={option.icon}
              label={option.label}
              selected={props.organizeMode === option.mode}
              onPress={() => props.onOrganize(option.mode)}
            />
          ))}
          <View style={[styles.menuDivider, { backgroundColor: theme.colors.border }]} />
          <Text style={[styles.menuLabel, { color: theme.colors.textMuted }]}>Manage</Text>
          <MenuRow icon="Cloud" label="Cloud tasks" onPress={props.onCloudTasks} />
          <MenuRow icon="Archive" label="Archived tasks" onPress={props.onArchived} />
          <MenuRow icon="Link" label="Add connection" onPress={props.onAddConnection} />
          <MenuRow icon="Settings" label="Settings" onPress={props.onSettings} />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

interface RemoteTaskMenuProps {
  visible: boolean;
  onClose: () => void;
  onChanges: () => void;
  onFiles: () => void;
}

export function RemoteTaskMenu(props: RemoteTaskMenuProps) {
  const { theme } = useTheme();
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <TouchableOpacity activeOpacity={1} onPress={props.onClose} style={styles.menuBackdrop}>
        <View
          style={[
            styles.menuCard,
            { backgroundColor: theme.colors.cardBackground, borderColor: theme.colors.border },
          ]}
        >
          <Text style={[styles.menuLabel, { color: theme.colors.textMuted }]}>Desktop task</Text>
          <MenuRow
            icon="Activity"
            label="Changes"
            accessibilityLabel="Open remote changes"
            onPress={props.onChanges}
          />
          <MenuRow
            icon="Folder"
            label="Files"
            accessibilityLabel="Open remote files"
            onPress={props.onFiles}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

type MenuIcon =
  | 'Folder'
  | 'History'
  | 'MessagesCircle'
  | 'Cloud'
  | 'Archive'
  | 'Link'
  | 'Settings'
  | 'Activity';

interface MenuRowProps {
  icon: MenuIcon;
  label: string;
  accessibilityLabel?: string;
  selected?: boolean;
  onPress: () => void;
}

function MenuRow(props: MenuRowProps) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      style={styles.menuRow}
    >
      <View style={styles.menuCheck}>
        {props.selected ? <Icon name="Check" size={16} color={theme.colors.text} /> : null}
      </View>
      <Icon name={props.icon} size={19} color={theme.colors.text} />
      <Text style={[styles.menuText, { color: theme.colors.text }]}>{props.label}</Text>
    </TouchableOpacity>
  );
}
