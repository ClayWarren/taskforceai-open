import React from 'react';
import { Text, TouchableOpacity } from 'react-native';

import { Icon } from '../../../components/Icon';
import { useTheme } from '../../../contexts/ThemeContext';

export function RemoteActionPill({
  label,
  icon,
  selected = false,
  danger = false,
  disabled = false,
  onPress,
}: {
  label: string;
  icon?: React.ComponentProps<typeof Icon>['name'];
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: selected ? '#1d4ed8' : theme.colors.cardBackground,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {icon ? <Icon name={icon} size={12} color={danger ? '#fca5a5' : theme.colors.text} /> : null}
      <Text style={{ color: danger ? '#fca5a5' : theme.colors.text, fontSize: 11, fontWeight: '600' }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function RemoteActionIcon({
  label,
  icon,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Icon>['name'];
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ opacity: disabled ? 0.4 : 1, padding: 8 }}
    >
      <Icon name={icon} size={18} color="#ffffff" />
    </TouchableOpacity>
  );
}

export function RemoteStatusText({ text }: { text: string }) {
  const { theme } = useTheme();
  return <Text selectable style={{ color: theme.colors.textMuted }}>{text}</Text>;
}

export function RemoteErrorText({ error }: { error: Error }) {
  return (
    <Text selectable style={{ color: '#fca5a5', lineHeight: 18 }}>
      {error.message}
    </Text>
  );
}
