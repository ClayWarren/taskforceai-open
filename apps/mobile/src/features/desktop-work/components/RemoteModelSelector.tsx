import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../../../components/Icon';
import { useTheme } from '../../../contexts/ThemeContext';

export function RemoteModelSelector({
  options,
  loading,
  selectedModelId,
  selectedEffort,
  onModelChange,
  onEffortChange,
}: {
  options: ModelOptionSummary[];
  loading: boolean;
  selectedModelId: string | null;
  selectedEffort: string | null;
  onModelChange: (modelId: string) => void;
  onEffortChange: (effort: string) => void;
}) {
  const { theme } = useTheme();
  const [visible, setVisible] = React.useState(false);
  const selected =
    options.find((option) => option.id === selectedModelId) ?? options[0] ?? null;
  const levels = selected?.reasoningEffortLevels ?? [];
  const effectiveEffort =
    (selectedEffort && levels.includes(selectedEffort) ? selectedEffort : null) ??
    selected?.defaultReasoningEffort ??
    levels[0] ??
    null;
  const label = selected?.label ?? 'Model';
  const compactLabel = effectiveEffort
    ? `${label} ${formatEffort(effectiveEffort)}`
    : label;

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Select Remote model"
        onPress={() => setVisible(true)}
        disabled={loading || options.length === 0}
        style={[styles.compactButton, { opacity: loading || options.length === 0 ? 0.5 : 1 }]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={theme.colors.text} />
        ) : (
          <>
            <Text style={[styles.compactLabel, { color: theme.colors.text }]} numberOfLines={1}>
              {compactLabel}
            </Text>
            <Icon name="ChevronUp" size={15} color={theme.colors.textMuted} />
          </>
        )}
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setVisible(false)}
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel="Close Remote model selector"
        >
          <SafeAreaView edges={['bottom']} style={styles.safeArea}>
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => undefined}
              style={[
                styles.card,
                { backgroundColor: theme.colors.cardBackground, borderColor: theme.colors.border },
              ]}
            >
              <View style={styles.headingRow}>
                <View>
                  <Text style={[styles.title, { color: theme.colors.text }]}>Model</Text>
                  <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>Runs on the paired Mac</Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close Remote model selector"
                  onPress={() => setVisible(false)}
                  style={styles.closeButton}
                >
                  <Icon name="X" size={20} color={theme.colors.text} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modelList} showsVerticalScrollIndicator={false}>
                {options.map((option) => {
                  const isSelected = option.id === selected?.id;
                  return (
                    <TouchableOpacity
                      key={option.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`Remote model: ${option.label}`}
                      onPress={() => onModelChange(option.id)}
                      style={[
                        styles.modelRow,
                        {
                          backgroundColor: isSelected ? 'rgba(59,130,246,0.13)' : 'transparent',
                        },
                      ]}
                    >
                      <View style={styles.modelCopy}>
                        <Text style={[styles.modelLabel, { color: theme.colors.text }]}>
                          {option.label}
                        </Text>
                        {option.description ? (
                          <Text style={[styles.modelDescription, { color: theme.colors.textMuted }]} numberOfLines={1}>
                            {option.description}
                          </Text>
                        ) : null}
                      </View>
                      {isSelected ? <Icon name="Check" size={19} color={theme.colors.primary} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {levels.length > 0 && effectiveEffort ? (
                <View style={styles.effortSection}>
                  <Text style={[styles.effortLabel, { color: theme.colors.text }]}>
                    {label} <Text style={{ color: theme.colors.textMuted }}>{formatEffort(effectiveEffort)}</Text>
                  </Text>
                  <View
                    style={[
                      styles.slider,
                      { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
                    ]}
                  >
                    <View
                      style={[
                        styles.sliderFill,
                        {
                          backgroundColor: theme.colors.primary,
                          width: `${((levels.indexOf(effectiveEffort) + 1) / levels.length) * 100}%`,
                        },
                      ]}
                    />
                    {levels.map((effort) => {
                      const active = effort === effectiveEffort;
                      return (
                        <TouchableOpacity
                          key={effort}
                          accessibilityRole="radio"
                          accessibilityLabel={`Remote reasoning effort: ${formatEffort(effort)}`}
                          accessibilityState={{ selected: active }}
                          onPress={() => onEffortChange(effort)}
                          style={styles.sliderStop}
                        >
                          <View
                            style={[
                              active ? styles.sliderThumb : styles.sliderDot,
                              {
                                backgroundColor: active ? '#ffffff' : theme.colors.textMuted,
                                borderColor: active ? theme.colors.primary : 'transparent',
                              },
                            ]}
                          />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </TouchableOpacity>
          </SafeAreaView>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const formatEffort = (effort: string): string =>
  effort === 'xhigh' ? 'Extra high' : effort.charAt(0).toUpperCase() + effort.slice(1);

const styles = StyleSheet.create({
  compactButton: { alignItems: 'center', flexDirection: 'row', gap: 3, maxWidth: 155, paddingVertical: 8 },
  compactLabel: { fontSize: 14, fontWeight: '600', maxWidth: 132 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.32)', flex: 1, justifyContent: 'flex-end' },
  safeArea: { width: '100%' },
  card: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: StyleSheet.hairlineWidth, maxHeight: '72%', padding: 18 },
  headingRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { fontSize: 21, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 2 },
  closeButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  modelList: { marginTop: 14, maxHeight: 300 },
  modelRow: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 12, minHeight: 58, paddingHorizontal: 12, paddingVertical: 9 },
  modelCopy: { flex: 1, minWidth: 0 },
  modelLabel: { fontSize: 16, fontWeight: '600' },
  modelDescription: { fontSize: 12, marginTop: 2 },
  effortSection: { alignItems: 'center', marginTop: 16 },
  effortLabel: { fontSize: 18, fontWeight: '600', marginBottom: 14 },
  slider: { borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', height: 64, overflow: 'hidden', paddingHorizontal: 10, width: '100%' },
  sliderFill: { bottom: 0, left: 0, opacity: 0.9, position: 'absolute', top: 0 },
  sliderStop: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  sliderDot: { borderRadius: 6, height: 12, opacity: 0.55, width: 12 },
  sliderThumb: { borderRadius: 24, borderWidth: 3, height: 48, width: 48 },
});
