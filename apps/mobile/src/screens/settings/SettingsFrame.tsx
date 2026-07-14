import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { EdgeInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import type { Theme } from '../../theme/theme';

interface SettingsFrameProps {
  visible: boolean;
  onClose: () => void;
  onBack: () => void;
  activeSectionLabel: string;
  isHome: boolean;
  insets: EdgeInsets;
  theme: Theme;
  backLabel: string;
  closeLabel: string;
  children: React.ReactNode;
}

export function SettingsFrame({
  visible,
  onClose,
  onBack,
  activeSectionLabel,
  isHome,
  insets,
  theme,
  backLabel,
  closeLabel,
  children,
}: SettingsFrameProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
          <View style={styles.headerSlot}>
            {!isHome ? (
              <TouchableOpacity
                onPress={onBack}
                style={[styles.headerBtn, { backgroundColor: theme.colors.cardBackground }]}
                accessibilityRole="button"
                accessibilityLabel={backLabel}
              >
                <Icon name="ChevronLeft" size={20} color={theme.colors.text} />
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]} numberOfLines={1}>
              {activeSectionLabel}
            </Text>
          </View>

          <View style={[styles.headerSlot, { alignItems: 'flex-end' }]}>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.headerBtn, { backgroundColor: theme.colors.cardBackground }]}
              hitSlop={{ top: 16, right: 16, bottom: 16, left: 16 }}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
            >
              <Icon name="X" size={18} color={theme.colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {isHome ? (
          children
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 8,
              flexGrow: 1,
              paddingBottom: Math.max(insets.bottom, 24),
            }}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerSlot: {
    width: 44,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
