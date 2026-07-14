import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../../components/Icon';
import { useTheme } from '../../../contexts/ThemeContext';
import { useDesktopReviewQuery, type DesktopReviewScope } from '../data/desktop-work';
import { RemoteActionPill, RemoteErrorText, RemoteStatusText } from './RemoteControls';

export function RemoteChangeSummaryPill({
  visible: controlledVisible,
  onVisibleChange,
}: {
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
} = {}) {
  const { theme } = useTheme();
  const [localVisible, setLocalVisible] = React.useState(false);
  const visible = controlledVisible ?? localVisible;
  const setVisible = onVisibleChange ?? setLocalVisible;
  const review = useDesktopReviewQuery('uncommitted', true);
  const summary = summarizeDesktopReview(review.data?.rawDiff ?? '', review.data?.files.length ?? 0);
  const showPill = review.isLoading || Boolean(review.error) || summary.files > 0;

  return (
    <>
      {showPill ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open remote desktop changes"
          onPress={() => setVisible(true)}
          style={[styles.summaryPill, { backgroundColor: theme.colors.cardBackground, borderColor: theme.colors.border }]}
        >
          {review.isLoading ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>Checking changes…</Text>
          ) : review.error ? (
            <Text style={{ color: '#fca5a5', fontSize: 12 }}>Changes unavailable</Text>
          ) : (
            <>
              <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>{summary.files} {summary.files === 1 ? 'file' : 'files'}</Text>
              <Text style={styles.additions}>+{summary.additions}</Text>
              <Text style={styles.deletions}>−{summary.deletions}</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}
      <RemoteChangesSheet visible={visible} onVisibleChange={setVisible} />
    </>
  );
}

function RemoteChangesSheet({ visible, onVisibleChange }: { visible: boolean; onVisibleChange: (visible: boolean) => void }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const review = useDesktopReviewQuery('uncommitted', true);
  const summary = summarizeDesktopReview(review.data?.rawDiff ?? '', review.data?.files.length ?? 0);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => onVisibleChange(false)}>
      <View style={styles.sheetBackdrop}>
        <TouchableOpacity accessibilityLabel="Dismiss remote changes" activeOpacity={1} onPress={() => onVisibleChange(false)} style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
          <View style={[styles.grabber, { backgroundColor: theme.colors.textMuted }]} />
          <View style={styles.sheetHeader}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close remote changes" onPress={() => onVisibleChange(false)} style={[styles.closeButton, { backgroundColor: theme.colors.cardBackground }]}>
              <Icon name="X" size={20} color={theme.colors.text} />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '700' }}>Changes</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                <Text style={styles.additions}>+{summary.additions}</Text>
                <Text style={styles.deletions}>−{summary.deletions}</Text>
              </View>
            </View>
            <View style={{ width: 40 }} />
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            <RemoteReviewPanel />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function RemoteReviewPanel() {
  const { theme } = useTheme();
  const [scope, setScope] = React.useState<DesktopReviewScope>('uncommitted');
  const review = useDesktopReviewQuery(scope, true);
  return (
    <View style={{ gap: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {reviewScopes.map((candidate) => (
          <RemoteActionPill
            key={candidate.value}
            label={candidate.label}
            selected={scope === candidate.value}
            onPress={() => setScope(candidate.value)}
          />
        ))}
      </ScrollView>
      {review.isLoading ? <RemoteStatusText text="Loading desktop changes…" /> : null}
      {review.error instanceof Error ? <RemoteErrorText error={review.error} /> : null}
      {review.data ? (
        <>
          <Text selectable style={{ color: theme.colors.textMuted, fontSize: 12 }}>
            {review.data.message}
          </Text>
          <View style={{ gap: 5 }}>
            {review.data.files.map((file) => (
              <View key={`${file.status}:${file.path}`} style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ color: '#93c5fd', width: 22, fontWeight: '700' }}>{file.status}</Text>
                <Text selectable style={{ flex: 1, color: theme.colors.text }}>
                  {file.path}
                </Text>
              </View>
            ))}
          </View>
          {review.data.rawDiff ? (
            <ScrollView horizontal style={{ borderRadius: 12, backgroundColor: '#05070a' }}>
              <Text selectable style={{ color: '#d1d5db', padding: 12, fontFamily: 'monospace', fontSize: 11, lineHeight: 17 }}>
                {review.data.rawDiff}
              </Text>
            </ScrollView>
          ) : null}
          {review.data.truncated ? <RemoteStatusText text="Diff truncated by the desktop safety limit." /> : null}
        </>
      ) : null}
    </View>
  );
}

const reviewScopes: Array<{ value: DesktopReviewScope; label: string }> = [
  { value: 'uncommitted', label: 'All' },
  { value: 'staged', label: 'Staged' },
  { value: 'unstaged', label: 'Unstaged' },
  { value: 'allBranchChanges', label: 'Branch' },
];

export const summarizeDesktopReview = (rawDiff: string, files: number) => {
  let additions = 0;
  let deletions = 0;
  for (const line of rawDiff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { files, additions, deletions };
};

const styles = StyleSheet.create({
  summaryPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  additions: { color: '#22c55e', fontSize: 12, fontWeight: '600' },
  deletions: { color: '#ef4444', fontSize: 12, fontWeight: '600' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.28)' },
  sheet: {
    maxHeight: '84%',
    minHeight: '56%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
  },
  grabber: { alignSelf: 'center', width: 46, height: 5, borderRadius: 99, marginTop: 8, opacity: 0.45 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 13 },
  closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sheetContent: { paddingHorizontal: 18, paddingBottom: 24 },
});
