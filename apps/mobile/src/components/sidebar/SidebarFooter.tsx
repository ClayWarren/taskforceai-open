import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface SidebarFooterProps {
  isAuthenticated: boolean;
  userName?: string;
  userInitials?: string;
  onSettingsPress?: () => void;
}

export function SidebarFooter({
  isAuthenticated,
  userName,
  userInitials,
  onSettingsPress,
}: SidebarFooterProps) {
  if (!isAuthenticated || !userName) {
    return null;
  }

  return (
    <TouchableOpacity
      onPress={onSettingsPress}
      activeOpacity={0.7}
      style={[styles.footer, { borderTopColor: 'rgba(255,255,255,0.08)' }]}
      accessibilityLabel="Open settings"
      accessibilityRole="button"
    >
      <View style={styles.footerAvatar}>
        <Text style={styles.footerAvatarText}>{userInitials}</Text>
      </View>
      <Text style={styles.footerName} numberOfLines={1}>{userName}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#007aff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerAvatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  footerName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#e2e8f0',
  },
});
