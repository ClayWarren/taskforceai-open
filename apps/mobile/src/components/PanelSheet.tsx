import { spacingTokens } from '@taskforceai/design-tokens';
import type { ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../contexts/ThemeContext';
import { Icon } from './Icon';

interface PanelSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  description: string;
  height: `${number}%`;
  children: ReactNode;
  titleIcon?: string;
  closeTestID?: string;
}

export function PanelSheet({
  visible,
  onClose,
  title,
  description,
  height,
  children,
  titleIcon,
  closeTestID,
}: PanelSheetProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}>
        <View
          style={[
            styles.container,
            {
              backgroundColor: theme.colors.background,
              height,
              paddingBottom: Math.max(insets.bottom, spacingTokens.md),
            },
          ]}
        >
          <View style={styles.dragHandleContainer}>
            <View style={styles.dragHandle} />
          </View>

          <View style={styles.header}>
            <View style={styles.titleRow}>
              {titleIcon ? <Text style={styles.titleIcon}>{titleIcon}</Text> : null}
              <Text style={styles.title}>{title}</Text>
            </View>
            <TouchableOpacity testID={closeTestID} onPress={onClose} style={styles.closeButton}>
              <Icon name="X" size={20} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.description}>{description}</Text>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingTokens.lg,
    paddingVertical: spacingTokens.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.sm,
  },
  titleIcon: {
    fontSize: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    paddingHorizontal: spacingTokens.lg,
    marginBottom: spacingTokens.md,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacingTokens.lg,
  },
});
