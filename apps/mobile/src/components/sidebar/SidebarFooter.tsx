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
    return (
      <TouchableOpacity
        onPress={onSettingsPress}
        activeOpacity={0.7}
        style={[styles.footer, { borderTopColor: 'rgba(255,255,255,0.08)' }]}
        accessibilityLabel="Open settings"
        accessibilityRole="button"
      >
        <View style={styles.footerAvatar}>
          <Text style={styles.footerAvatarText}>TF</Text>
        </View>
        <View style={styles.footerTextGroup}>
          <Text style={styles.footerName} numberOfLines={1}>Guest settings</Text>
          <Text style={styles.footerSubtitle} numberOfLines={1}>Privacy, support, and local data</Text>
        </View>
      </TouchableOpacity>
    );
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
      <View style={styles.footerTextGroup}>
        <Text style={styles.footerName} numberOfLines={1}>{userName}</Text>
      </View>
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
    fontSize: 14,
    fontWeight: '500',
    color: '#e2e8f0',
  },
  footerSubtitle: {
    color: 'rgba(148,163,184,0.7)',
    fontSize: 11,
    lineHeight: 15,
  },
  footerTextGroup: {
    flex: 1,
  },
});
