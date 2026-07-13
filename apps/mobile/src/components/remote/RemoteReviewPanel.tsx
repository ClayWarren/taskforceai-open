import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useTheme } from '../../contexts/ThemeContext';
import { useDesktopReviewQuery, type DesktopReviewScope } from '../../hooks/api/desktopWork';
import { RemoteActionPill, RemoteErrorText, RemoteStatusText } from './RemoteControls';

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
