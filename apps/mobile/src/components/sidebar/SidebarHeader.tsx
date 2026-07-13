import { spacingTokens } from '@taskforceai/design-tokens';
import React from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { Icon } from '../Icon';

interface SidebarHeaderProps {
  SidebarComponent: React.ComponentType<React.PropsWithChildren<Record<string, unknown>>>;
  useGlass: boolean;
  searchQuery: string;
  setSearchQuery: (_next: string) => void;
  onNewChat: () => void;
  searchLabel: string;
  newChatLabel: string;
}

export function SidebarHeader({
  SidebarComponent,
  useGlass,
  searchQuery,
  setSearchQuery,
  onNewChat,
  searchLabel,
  newChatLabel,
}: SidebarHeaderProps) {
  return (
    <View style={[styles.topBar, { paddingTop: spacingTokens.md }]}>
      <View style={styles.searchRow}>
        <SidebarComponent
          style={[
            styles.searchPill,
            !useGlass && { backgroundColor: 'rgba(255,255,255,0.08)' },
          ]}
          {...(useGlass ? { glassEffectStyle: 'regular', tintColor: '#2a2a2a' } : {})}
        >
          <Icon name="Search" size={15} color="rgba(148,163,184,0.7)" strokeWidth={2} />
          <TextInput
            style={styles.searchInput}
            placeholder={searchLabel}
            placeholderTextColor="rgba(148,163,184,0.6)"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={searchLabel}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Icon name="X" size={14} color="rgba(148,163,184,0.7)" />
            </TouchableOpacity>
          )}
        </SidebarComponent>

        <TouchableOpacity
          onPress={onNewChat}
          activeOpacity={0.75}
          accessibilityLabel={newChatLabel}
          accessibilityRole="button"
        >
          <SidebarComponent
            style={[
              styles.iconBtn,
              !useGlass && { backgroundColor: 'rgba(255,255,255,0.08)' },
            ]}
            {...(useGlass ? { glassEffectStyle: 'regular', tintColor: '#2a2a2a' } : {})}
          >
            <Icon name="SquarePen" size={20} color="#e2e8f0" strokeWidth={1.5} />
          </SidebarComponent>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    overflow: 'hidden',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#e2e8f0',
    padding: 0,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
});
