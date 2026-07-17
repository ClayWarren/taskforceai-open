import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

import { DesktopGitDiffPreview } from './DesktopGitDiffPreview';
import { DesktopGitReviewPanel } from './DesktopGitReviewPanel';
import type { DesktopGitReviewController } from './useDesktopGitReview';

const gitDiff = (rawDiff: string) => ({
  isGitRepository: true,
  workspace: '/workspace',
  repositoryRoot: '/workspace',
  scope: 'uncommitted' as const,
  baseRef: 'main',
  rawDiff,
  files: [],
  truncated: false,
  message: 'Diff loaded.',
});

describe('DesktopGitReviewPanel', () => {
  afterEach(cleanup);

  it('renders empty and unstructured diff fallbacks', () => {
    const { rerender } = render(<DesktopGitDiffPreview diff={gitDiff('')} />);
    expect(screen.getByText('No diff for this scope.')).toBeTruthy();

    rerender(<DesktopGitDiffPreview diff={gitDiff('plain-text diff')} />);
    expect(screen.getByText('plain-text diff').tagName).toBe('PRE');
  });

  it('renders last-turn choices, inline threads, and draft pull request actions', () => {
    const refresh = mock();
    const runPullRequestAction = mock();
    const selectThread = mock();
    const toggleComment = mock();
    const review = {
      addComment: mock(),
      commentBody: 'Please cover this range',
      commentEndLine: '9',
      commentLine: '7',
      commentPath: 'src/app.ts',
      comments: [
        {
          id: 'comment-1',
          workspace: '/workspace',
          path: 'src/app.ts',
          line: 7,
          endLine: 9,
          body: 'Please cover this range',
          resolved: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      diff: gitDiff(
        'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -7 +7 @@\n-old\n+new'
      ),
      loading: false,
      message: null,
      refresh,
      reviewBody: 'Ready after one fix',
      runPullRequestAction,
      scope: 'lastTurn',
      selectScope: mock(),
      selectThread,
      sessions: [
        {
          sessionId: 'code-session',
          title: 'Code task',
          taskMode: 'code',
        },
        {
          sessionId: 'work-session',
          title: 'Work task',
          taskMode: 'work',
        },
      ],
      setCommentBody: mock(),
      setCommentEndLine: mock(),
      setCommentLine: mock(),
      setCommentPath: mock(),
      setReviewBody: mock(),
      setWorkspace: mock(),
      stageFile: mock(),
      status: {
        isGitRepository: true,
        workspace: '/workspace',
        repositoryRoot: '/workspace',
        branch: 'main',
        head: 'abc123',
        upstream: null,
        baseRef: 'main',
        hasStagedChanges: false,
        hasUnstagedChanges: true,
        hasUntrackedFiles: false,
        files: [
          {
            path: 'src/app.ts',
            oldPath: null,
            indexStatus: null,
            worktreeStatus: 'M',
            staged: false,
            unstaged: true,
            untracked: false,
          },
        ],
        pullRequest: {
          number: 42,
          title: 'Draft review',
          url: 'https://github.com/taskforceai/taskforceai/pull/42',
          state: 'OPEN',
          headRefName: 'codex/draft-review',
          baseRefName: 'main',
          isDraft: true,
          reviewDecision: null,
          commentCount: 1,
          reviewCount: 0,
          changedFileCount: 1,
          latestReviews: [],
        },
        message: 'Git repository detected.',
      },
      threadId: '',
      toggleComment,
      workspace: '/workspace',
      workspaceRoots: ['/workspace', '/other-workspace'],
    } as unknown as DesktopGitReviewController;

    render(<DesktopGitReviewPanel review={review} />);

    expect(screen.getByText('Code task')).toBeTruthy();
    expect(screen.queryByText('Work task')).toBeNull();
    expect(document.querySelector('option[value="/other-workspace"]')).toBeTruthy();
    expect(screen.getByText('src/app.ts:7-9')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Last-turn code thread'), {
      target: { value: 'code-session' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready' }));
    fireEvent.click(screen.getAllByLabelText('Comment on src/app.ts line 7')[0]!);

    expect(selectThread).toHaveBeenCalledWith('code-session');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toggleComment).toHaveBeenCalledWith(review.comments[0]);
    expect(runPullRequestAction).toHaveBeenCalledWith('markReady');
    expect(review.setCommentPath).toHaveBeenCalledWith('src/app.ts');
    expect(review.setCommentLine).toHaveBeenCalledWith('7');
    expect(review.setCommentEndLine).toHaveBeenCalledWith('');
  });
});
