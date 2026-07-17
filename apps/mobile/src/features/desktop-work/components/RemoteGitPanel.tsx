import React from 'react';
import { Alert, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  useDesktopGitBranchesQuery,
  useDesktopGitFinishMutation,
  useDesktopGitStatusQuery,
  useDesktopReviewActionMutation,
  type DesktopGitBranch,
  type DesktopGitFinishAction,
} from '../data/desktop-work';
import { RemoteActionPill, RemoteErrorText, RemoteStatusText } from './RemoteControls';

// eslint-disable-next-line complexity -- Git actions intentionally expose independent repository states and controls.
export function RemoteGitPanel({ workspace = null }: { workspace?: string | null }) {
  const { theme } = useTheme();
  const [commitMessage, setCommitMessage] = React.useState('');
  const [branchName, setBranchName] = React.useState('');
  const [pullRequestTitle, setPullRequestTitle] = React.useState('');
  const [pullRequestBody, setPullRequestBody] = React.useState('');
  const [draft, setDraft] = React.useState(false);
  const [lastMessage, setLastMessage] = React.useState<string | null>(null);
  const status = useDesktopGitStatusQuery(workspace, Boolean(workspace));
  const branches = useDesktopGitBranchesQuery(workspace, Boolean(workspace));
  const finish = useDesktopGitFinishMutation();
  const review = useDesktopReviewActionMutation();
  const currentBranch = status.data?.branch ?? null;
  const isDefaultBranch = currentBranch === 'main' || currentBranch === 'master';
  const stageablePaths = status.data?.files.filter((file) => !file.staged).map((file) => file.path) ?? [];
  const stagedPaths = status.data?.files.filter((file) => file.staged).map((file) => file.path) ?? [];

  const run = (action: DesktopGitFinishAction, success?: () => void) => {
    finish.mutate(action, {
      onSuccess: (result) => {
        setLastMessage(result.message);
        success?.();
      },
    });
  };

  const confirmDefaultBranch = (label: string, action: () => void) => {
    if (!isDefaultBranch) {
      action();
      return;
    }
    Alert.alert(
      `${label} ${currentBranch}`,
      `You are on the default branch (${currentBranch}). Continue on the paired desktop?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: label, onPress: action },
      ]
    );
  };

  const checkout = (branch: DesktopGitBranch) => {
    if (!workspace || branch.current) return;
    const action = () =>
      run({ kind: 'checkout', workspace, branch: branch.name, remote: branch.remote });
    if (status.data?.hasStagedChanges || status.data?.hasUnstagedChanges) {
      Alert.alert(
        `Check out ${branch.name}?`,
        'Uncommitted changes remain in this workspace. Git will stop the checkout if they conflict.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Check out', onPress: action },
        ]
      );
    } else {
      action();
    }
  };

  if (!workspace) return <RemoteStatusText text="Choose a project workspace to use Git." />;
  if (status.isLoading) return <RemoteStatusText text="Loading Git status…" />;
  if (status.error instanceof Error) return <RemoteErrorText error={status.error} />;
  if (!status.data?.isGitRepository) {
    return <RemoteStatusText text="This project workspace is not a Git repository." />;
  }

  const busy = finish.isPending || review.isPending;
  return (
    <View style={{ gap: 14 }}>
      <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.cardBackground }]}>
        <View style={styles.titleRow}>
          <Icon name="GitPullRequest" size={18} color={theme.colors.text} />
          <View style={{ flex: 1 }}>
            <Text selectable style={{ color: theme.colors.text, fontWeight: '700' }}>
              {currentBranch ?? 'Detached HEAD'}
            </Text>
            <Text selectable style={{ color: theme.colors.textMuted, fontSize: 11 }}>
              {status.data.upstream ?? 'No upstream yet'}{status.data.head ? ` · ${status.data.head}` : ''}
            </Text>
          </View>
        </View>
        <View style={styles.summaryRow}>
          <StatusCount label="staged" active={status.data.hasStagedChanges} />
          <StatusCount label="unstaged" active={status.data.hasUnstagedChanges} />
          <StatusCount label="untracked" active={status.data.hasUntrackedFiles} />
        </View>
        {lastMessage ? <Text selectable style={{ color: '#86efac', fontSize: 12 }}>{lastMessage}</Text> : null}
        {finish.error instanceof Error ? <RemoteErrorText error={finish.error} /> : null}
      </View>

      <Section title="Commit" subtitle="Stage changes, then commit them on the paired desktop.">
        <View style={styles.actionRow}>
          <RemoteActionPill
            label="Stage all"
            onPress={() => stageablePaths.length && review.mutate({ kind: 'stage', workspace, paths: stageablePaths, staged: true })}
          />
          <RemoteActionPill
            label="Unstage all"
            onPress={() => stagedPaths.length && review.mutate({ kind: 'stage', workspace, paths: stagedPaths, staged: false })}
          />
        </View>
        <TextInput
          value={commitMessage}
          onChangeText={setCommitMessage}
          placeholder="Commit message"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="Remote Git commit message"
          multiline
          style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.cardBackground, borderColor: theme.colors.border }]}
        />
        <PrimaryButton
          label={busy ? 'Working…' : 'Commit staged changes'}
          disabled={busy || !status.data.hasStagedChanges || !commitMessage.trim()}
          onPress={() =>
            confirmDefaultBranch('Commit on', () =>
              run({ kind: 'commit', workspace, message: commitMessage.trim() }, () => setCommitMessage(''))
            )
          }
        />
      </Section>

      <Section title="Sync" subtitle="Pull is fast-forward-only. Push configures origin when this branch has no upstream.">
        <View style={styles.actionRow}>
          <PrimaryButton
            label="Pull"
            disabled={busy}
            onPress={() => run({ kind: 'pull', workspace })}
          />
          <PrimaryButton
            label="Push"
            disabled={busy}
            onPress={() => confirmDefaultBranch('Push', () => run({ kind: 'push', workspace }))}
          />
        </View>
      </Section>

      <Section title="Branches" subtitle="Create from the current HEAD, or check out an existing local or remote branch.">
        <View style={styles.inlineInput}>
          <TextInput
            value={branchName}
            onChangeText={setBranchName}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="codex/my-branch"
            placeholderTextColor={theme.colors.textMuted}
            accessibilityLabel="New Remote Git branch"
            style={[styles.input, { flex: 1, color: theme.colors.text, backgroundColor: theme.colors.cardBackground, borderColor: theme.colors.border }]}
          />
          <PrimaryButton
            label="Create"
            disabled={busy || !branchName.trim()}
            onPress={() => run({ kind: 'createBranch', workspace, branch: branchName.trim() }, () => setBranchName(''))}
          />
        </View>
        {branches.error instanceof Error ? <RemoteErrorText error={branches.error} /> : null}
        <View style={{ gap: 2 }}>
          {(branches.data?.branches ?? []).map((branch) => (
            <TouchableOpacity
              key={`${branch.remote ? 'remote' : 'local'}:${branch.name}`}
              accessibilityRole="button"
              accessibilityLabel={`${branch.current ? 'Current branch' : 'Check out'} ${branch.name}`}
              accessibilityState={{ selected: branch.current, disabled: branch.current || busy }}
              disabled={branch.current || busy}
              onPress={() => checkout(branch)}
              style={styles.branchRow}
            >
              <Icon name={branch.current ? 'Check' : 'ChevronRight'} size={14} color={branch.current ? '#86efac' : theme.colors.textMuted} />
              <Text selectable style={{ flex: 1, color: theme.colors.text, fontSize: 12 }}>{branch.name}</Text>
              {branch.remote ? <Text style={{ color: theme.colors.textMuted, fontSize: 10 }}>REMOTE</Text> : null}
            </TouchableOpacity>
          ))}
        </View>
      </Section>

      <Section title="Pull request" subtitle="Open the current pull request, or create one with GitHub CLI on the paired desktop.">
        {status.data.pullRequest ? (
          <TouchableOpacity
            accessibilityRole="link"
            onPress={() => void Linking.openURL(status.data.pullRequest!.url)}
            style={[styles.prRow, { borderColor: theme.colors.border }]}
          >
            <View style={{ flex: 1 }}>
              <Text selectable style={{ color: theme.colors.text, fontWeight: '700' }} numberOfLines={1}>
                #{status.data.pullRequest.number} · {status.data.pullRequest.title}
              </Text>
              <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>
                {status.data.pullRequest.isDraft ? 'Draft' : 'Open'}
              </Text>
            </View>
            <Icon name="ArrowUpRight" size={16} color={theme.colors.textMuted} />
          </TouchableOpacity>
        ) : (
          <>
            <TextInput
              value={pullRequestTitle}
              onChangeText={setPullRequestTitle}
              placeholder="Title (blank uses commits)"
              placeholderTextColor={theme.colors.textMuted}
              accessibilityLabel="Remote pull request title"
              style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.cardBackground, borderColor: theme.colors.border }]}
            />
            <TextInput
              value={pullRequestBody}
              onChangeText={setPullRequestBody}
              placeholder="Description"
              placeholderTextColor={theme.colors.textMuted}
              accessibilityLabel="Remote pull request description"
              multiline
              style={[styles.input, styles.bodyInput, { color: theme.colors.text, backgroundColor: theme.colors.cardBackground, borderColor: theme.colors.border }]}
            />
            <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: draft }} onPress={() => setDraft((value) => !value)} style={styles.checkRow}>
              <View style={[styles.checkbox, { borderColor: theme.colors.border, backgroundColor: draft ? theme.colors.text : 'transparent' }]}>
                {draft ? <Icon name="Check" size={12} color={theme.colors.background} /> : null}
              </View>
              <Text style={{ color: theme.colors.text }}>Create as draft</Text>
            </TouchableOpacity>
            <PrimaryButton
              label="Create pull request"
              disabled={busy}
              onPress={() => run({
                kind: 'createPullRequest',
                workspace,
                title: pullRequestTitle.trim() || undefined,
                body: pullRequestBody.trim() || undefined,
                draft,
              })}
            />
          </>
        )}
      </Section>
    </View>
  );
}

function Section({ title, subtitle, children }: React.PropsWithChildren<{ title: string; subtitle: string }>) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}>{title}</Text>
      <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>{subtitle}</Text>
      {children}
    </View>
  );
}

function PrimaryButton({ label, disabled = false, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor: theme.colors.text, opacity: disabled ? 0.42 : 1 }]}
    >
      <Text style={{ color: theme.colors.background, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
}

function StatusCount({ label, active }: { label: string; active: boolean }) {
  return <Text style={{ color: active ? '#fbbf24' : '#6b7280', fontSize: 11 }}>{active ? '●' : '○'} {label}</Text>;
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 12, gap: 9 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 10, minHeight: 42 },
  bodyInput: { minHeight: 90, textAlignVertical: 'top' },
  inlineInput: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: { minHeight: 40, borderRadius: 10, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  branchRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  prRow: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 20, height: 20, borderWidth: StyleSheet.hairlineWidth, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
});
