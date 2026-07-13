import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon } from './Icon';

export type MobileTaskMode = 'chat' | 'work';

const modes = [
  { id: 'chat', label: 'Chat', icon: 'Zap' },
  { id: 'work', label: 'Work', icon: 'Users' },
] as const;

export function MobileTaskModeSwitcher(props: {
  mode: MobileTaskMode;
  onModeChange: (_mode: MobileTaskMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedMode = modes.find(({ id }) => id === props.mode) ?? modes[0];

  const selectMode = (mode: MobileTaskMode) => {
    props.onModeChange(mode);
    setOpen(false);
  };

  return (
    <View testID="mobile-task-mode-switcher" className="relative z-50 items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${selectedMode.label} mode selector`}
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-1 rounded-full px-4 py-2"
        onPress={() => setOpen((value) => !value)}
      >
        <Text className="text-base font-semibold" style={{ color: '#ffffff' }}>
          {selectedMode.label}
        </Text>
        <Icon name="ChevronDown" size={16} color="#ffffff" />
      </Pressable>
      {open ? (
        <View className="absolute top-12 w-56 rounded-3xl border border-white/10 bg-card p-2 shadow-xl">
          {modes.map(({ id, label, icon }) => {
            const active = props.mode === id;
            return (
              <Pressable
                key={id}
                accessibilityRole="menuitem"
                accessibilityLabel={`${label} mode`}
                accessibilityState={{ selected: active }}
                className="flex-row items-center gap-3 rounded-2xl px-4 py-3"
                onPress={() => selectMode(id)}
              >
                <Icon name={icon} size={16} color={active ? '#bfdbfe' : '#94a3b8'} />
                <Text className="flex-1 text-base" style={{ color: '#ffffff' }}>
                  {label}
                </Text>
                {active ? <Icon name="Check" size={17} color="#bfdbfe" /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
