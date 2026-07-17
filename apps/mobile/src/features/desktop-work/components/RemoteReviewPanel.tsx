import React from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../../components/Icon';
import { usePreferences } from '../../../contexts/PreferencesContext';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  useDesktopGitStatusQuery,
  useDesktopReviewActionMutation,
  useDesktopReviewQuery,
  type DesktopReviewScope,
} from '../data/desktop-work';
import { RemoteActionPill, RemoteErrorText, RemoteStatusText } from './RemoteControls';

export function RemoteChangeSummaryPill({
  workspace = null,
  visible: controlledVisible,
  onVisibleChange,
}: {
  visible?: boolean;
  workspace?: string | null;
  onVisibleChange?: (visible: boolean) => void;
} = {}) {
  const { theme } = useTheme();
  const [localVisible, setLocalVisible] = React.useState(false);
  const visible = controlledVisible ?? localVisible;
  const setVisible = onVisibleChange ?? setLocalVisible;
  const review = useDesktopReviewQuery('uncommitted', workspace, true);
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
      <RemoteChangesSheet workspace={workspace} visible={visible} onVisibleChange={setVisible} />
    </>
  );
}

function RemoteChangesSheet({ workspace, visible, onVisibleChange }: { workspace: string | null; visible: boolean; onVisibleChange: (visible: boolean) => void }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const review = useDesktopReviewQuery('uncommitted', workspace, true);
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
            <RemoteReviewPanel workspace={workspace} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function RemoteReviewPanel({
  workspace = null,
  threadId = null,
}: {
  workspace?: string | null;
  threadId?: string | null;
}) {
  const { theme } = useTheme();
  const { remoteCodeScale, remoteWordWrap } = usePreferences();
  const [scope, setScope] = React.useState<DesktopReviewScope>('uncommitted');
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null);
  const [commentTarget, setCommentTarget] = React.useState<ReviewCommentTarget | null>(null);
  const [rangeStart, setRangeStart] = React.useState<{ path: string; line: number } | null>(null);
  const [commentBody, setCommentBody] = React.useState('');
  const [pullRequestBody, setPullRequestBody] = React.useState('');
  const review = useDesktopReviewQuery(scope, workspace, true, threadId);
  const status = useDesktopGitStatusQuery(workspace, Boolean(workspace));
  const action = useDesktopReviewActionMutation();
  const diffLines = parseUnifiedDiff(review.data?.rawDiff ?? '').filter(
    (line) => !selectedFile || line.path === selectedFile
  );

  const runPullRequestAction = (
    pullRequestAction: 'comment' | 'approve' | 'requestChanges' | 'markReady'
  ) => {
    if (!workspace) return;
    const requiresBody =
      pullRequestAction === 'comment' || pullRequestAction === 'requestChanges';
    if (requiresBody && !pullRequestBody.trim()) {
      Alert.alert('Review summary required', 'Add a review summary before sending this action.');
      return;
    }
    action.mutate(
      {
        kind: 'pullRequest',
        workspace,
        action: pullRequestAction,
        body: pullRequestBody.trim() || undefined,
      },
      {
        onSuccess: () => {
          setPullRequestBody('');
          Alert.alert('Pull request', 'The review action was sent.');
        },
      }
    );
  };
  return (
    <View style={{ gap: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {reviewScopes.filter((candidate) => candidate.value !== 'lastTurn' || threadId).map((candidate) => (
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
              <TouchableOpacity
                key={`${file.status}:${file.path}`}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedFile === file.path }}
                onPress={() => setSelectedFile((current) => current === file.path ? null : file.path)}
                style={[styles.fileCard, { backgroundColor: selectedFile === file.path ? theme.colors.cardBackground : 'transparent' }]}
              >
                <Text style={{ color: '#93c5fd', width: 22, fontWeight: '700' }}>{file.status}</Text>
                <Text selectable style={{ flex: 1, color: theme.colors.text }}>
                  {file.path}
                </Text>
                {workspace && scope !== 'allBranchChanges' && scope !== 'lastTurn' ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`${scope === 'staged' ? 'Unstage' : 'Stage'} ${file.path}`}
                    onPress={() => action.mutate({ kind: 'stage', workspace, paths: [file.path], staged: scope !== 'staged' })}
                    style={[styles.miniAction, { borderColor: theme.colors.border }]}
                  >
                    <Text style={{ color: theme.colors.text, fontSize: 11, fontWeight: '600' }}>
                      {scope === 'staged' ? 'Unstage' : 'Stage'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
          {status.data?.pullRequest ? (
            <View style={[styles.reviewActions, { borderColor: theme.colors.border }]}>
              <Text selectable style={{ flex: 1, color: theme.colors.text, fontWeight: '600' }} numberOfLines={1}>
                PR #{status.data.pullRequest.number} · {status.data.pullRequest.title}
              </Text>
              <TextInput
                value={pullRequestBody}
                onChangeText={setPullRequestBody}
                placeholder="Optional summary (required for comments or changes)"
                placeholderTextColor={theme.colors.textMuted}
                multiline
                style={[styles.pullRequestInput, { color: theme.colors.text, backgroundColor: theme.colors.cardBackground }]}
              />
              {status.data.pullRequest.isDraft ? (
                <RemoteActionPill label="Ready" onPress={() => runPullRequestAction('markReady')} />
              ) : (
                <>
                  <RemoteActionPill label="Comment" onPress={() => runPullRequestAction('comment')} />
                  <RemoteActionPill label="Approve" onPress={() => runPullRequestAction('approve')} />
                  <RemoteActionPill label="Request changes" onPress={() => runPullRequestAction('requestChanges')} />
                </>
              )}
            </View>
          ) : null}
          {commentTarget ? (
            <View style={[styles.commentComposer, { backgroundColor: theme.colors.cardBackground }]}>
              <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>
                {commentTarget.path}:{commentTarget.line}
                {commentTarget.endLine && commentTarget.endLine !== commentTarget.line
                  ? `–${commentTarget.endLine}`
                  : ''}
              </Text>
              <TextInput
                value={commentBody}
                onChangeText={setCommentBody}
                placeholder="Leave a review comment"
                placeholderTextColor={theme.colors.textMuted}
                multiline
                autoFocus
                style={{ color: theme.colors.text, minHeight: 52 }}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                <RemoteActionPill label="Cancel" onPress={() => setCommentTarget(null)} />
                <RemoteActionPill
                  label="Add comment"
                  selected={Boolean(commentBody.trim())}
                  onPress={() => {
                    if (!workspace || !commentBody.trim()) return;
                    action.mutate(
                      { kind: 'comment', workspace, ...commentTarget, body: commentBody.trim() },
                      {
                        onSuccess: () => {
                          setCommentBody('');
                          setCommentTarget(null);
                        },
                      }
                    );
                  }}
                />
              </View>
            </View>
          ) : null}
          {rangeStart ? (
            <View style={[styles.rangeHint, { borderColor: theme.colors.border }]}>
              <Text style={{ flex: 1, color: theme.colors.textMuted, fontSize: 12 }}>
                Range starts at {rangeStart.path}:{rangeStart.line}. Tap the last line.
              </Text>
              <RemoteActionPill label="Cancel range" onPress={() => setRangeStart(null)} />
            </View>
          ) : null}
          {review.data.rawDiff ? (
            <ScrollView horizontal={!remoteWordWrap} style={{ borderRadius: 12, backgroundColor: '#05070a' }}>
              <View style={{ minWidth: '100%', paddingVertical: 10 }}>
                <View style={styles.diffHeader}>
                  <Text style={styles.diffHeaderNumber}>Old</Text>
                  <Text style={styles.diffHeaderNumber}>New</Text>
                  <Text style={styles.diffHeaderLabel}>Code</Text>
                </View>
                {diffLines.map((line, index) => (
                  <TouchableOpacity
                    key={`${index}:${line.text}`}
                    disabled={!line.path || !line.newLine}
                    onPress={() => {
                      if (!line.path || !line.newLine) return;
                      if (rangeStart?.path === line.path) {
                        setCommentTarget(reviewRangeTarget(line.path, rangeStart.line, line.newLine));
                        setRangeStart(null);
                      } else {
                        setCommentTarget({ path: line.path, line: line.newLine });
                        setRangeStart(null);
                      }
                    }}
                    onLongPress={() => {
                      if (!line.path || !line.newLine) return;
                      setCommentTarget(null);
                      setRangeStart({ path: line.path, line: line.newLine });
                    }}
                    delayLongPress={300}
                    accessibilityHint="Tap to comment on this line. Long press, then tap another line to select a range."
                    style={[
                      styles.diffLine,
                      line.kind === 'file' ? styles.diffFileLine : null,
                      line.kind === 'hunk' ? styles.diffHunkLine : null,
                      {
                        backgroundColor: isReviewLineSelected(line, commentTarget, rangeStart)
                          ? 'rgba(59,130,246,0.22)'
                          : diffBackground(line.kind),
                      },
                    ]}
                  >
                    <Text selectable style={styles.diffLineNumber}>
                      {line.oldLine ?? ''}
                    </Text>
                    <Text selectable style={styles.diffLineNumber}>
                      {line.newLine ?? ''}
                    </Text>
                    <Text
                      selectable
                      style={{
                        color: diffColor(line.kind),
                        fontFamily: 'monospace',
                        fontSize: 11 * remoteCodeScale,
                        fontWeight: line.kind === 'file' ? '700' : '400',
                        lineHeight: 18 * remoteCodeScale,
                        flexShrink: remoteWordWrap ? 1 : 0,
                      }}
                    >
                      {line.kind === 'file' && line.path ? line.path : line.text || ' '}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          ) : null}
          {review.data.truncated ? <RemoteStatusText text="Diff truncated by the desktop safety limit." /> : null}
        </>
      ) : null}
    </View>
  );
}

const reviewScopes: Array<{ value: DesktopReviewScope; label: string }> = [
  { value: 'lastTurn', label: 'Last turn' },
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

export type ReviewCommentTarget = { path: string; line: number; endLine?: number };

export const reviewRangeTarget = (
  path: string,
  firstLine: number,
  secondLine: number
): ReviewCommentTarget => ({
  path,
  line: Math.min(firstLine, secondLine),
  endLine: Math.max(firstLine, secondLine),
});

const isReviewLineSelected = (
  line: ParsedDiffLine,
  target: ReviewCommentTarget | null,
  rangeStart: { path: string; line: number } | null
) => {
  if (!line.path || !line.newLine) return false;
  if (rangeStart) return rangeStart.path === line.path && rangeStart.line === line.newLine;
  if (!target || target.path !== line.path) return false;
  return line.newLine >= target.line && line.newLine <= (target.endLine ?? target.line);
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
  fileCard: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 7 },
  miniAction: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  reviewActions: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  pullRequestInput: { minHeight: 44, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  commentComposer: { gap: 7, borderRadius: 12, padding: 10 },
  rangeHint: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10 },
  diffLine: { minHeight: 17, flexDirection: 'row', paddingHorizontal: 10 },
  diffFileLine: { marginTop: 8, paddingVertical: 7, backgroundColor: 'rgba(139,92,246,0.14)' },
  diffHunkLine: { marginTop: 4, paddingVertical: 3 },
  diffHeader: { flexDirection: 'row', paddingHorizontal: 10, paddingBottom: 6 },
  diffHeaderNumber: { width: 42, color: '#6b7280', fontSize: 9, fontWeight: '700' },
  diffHeaderLabel: { color: '#6b7280', fontSize: 9, fontWeight: '700' },
  diffLineNumber: { color: '#4b5563', width: 42, fontFamily: 'monospace', fontSize: 10, lineHeight: 18 },
});

export type ParsedDiffLine = {
  kind: 'file' | 'hunk' | 'addition' | 'deletion' | 'context' | 'metadata';
  text: string;
  path: string | null;
  oldLine: number | null;
  newLine: number | null;
};

export const parseUnifiedDiff = (rawDiff: string): ParsedDiffLine[] => {
  const lines: ParsedDiffLine[] = [];
  let path: string | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const text of rawDiff.split('\n')) {
    if (text.startsWith('diff --git ')) {
      const match = text.match(/^diff --git a\/(.+) b\/(.+)$/);
      path = match?.[2] ?? path;
      lines.push({ kind: 'file', text, path, oldLine: null, newLine: null });
      continue;
    }
    if (text.startsWith('@@')) {
      const match = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = Number(match?.[1] ?? 0);
      newLine = Number(match?.[2] ?? 0);
      lines.push({ kind: 'hunk', text, path, oldLine: null, newLine: null });
      continue;
    }
    if (text.startsWith('+') && !text.startsWith('+++')) {
      lines.push({ kind: 'addition', text, path, oldLine: null, newLine });
      newLine += 1;
      continue;
    }
    if (text.startsWith('-') && !text.startsWith('---')) {
      lines.push({ kind: 'deletion', text, path, oldLine, newLine: null });
      oldLine += 1;
      continue;
    }
    if (text.startsWith(' ')) {
      lines.push({ kind: 'context', text, path, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
      continue;
    }
    lines.push({ kind: 'metadata', text, path, oldLine: null, newLine: null });
  }
  return lines;
};

const diffColor = (kind: ParsedDiffLine['kind']): string => {
  if (kind === 'addition') return '#86efac';
  if (kind === 'deletion') return '#fca5a5';
  if (kind === 'hunk') return '#93c5fd';
  if (kind === 'file') return '#c4b5fd';
  if (kind === 'metadata') return '#6b7280';
  return '#d1d5db';
};

const diffBackground = (kind: ParsedDiffLine['kind']): string => {
  if (kind === 'addition') return 'rgba(34,197,94,0.10)';
  if (kind === 'deletion') return 'rgba(239,68,68,0.10)';
  if (kind === 'hunk') return 'rgba(59,130,246,0.10)';
  return 'transparent';
};
