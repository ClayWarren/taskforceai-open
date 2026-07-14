import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const addDesktopGitReviewComment = mock();
const getDesktopGitReviewDiff = mock();
const getDesktopGitReviewStatus = mock();
const listDesktopGitReviewComments = mock();
const resolveDesktopGitReviewComment = mock();
const runDesktopGitReviewPullRequestAction = mock();
const updateDesktopGitReviewStage = mock();
const loggerWarn = mock();

mock.module('@taskforceai/web/app/lib/desktop/task-mode', () => ({
  readDesktopCodeWorkspaceRoots: () => ['/workspace'],
}));
mock.module('@taskforceai/web/app/lib/logger', () => ({ logger: { warn: loggerWarn } }));
mock.module('../platform/app-server', () => ({
  addDesktopGitReviewComment,
  getDesktopGitReviewDiff,
  getDesktopGitReviewStatus,
  listDesktopGitReviewComments,
  resolveDesktopGitReviewComment,
  runDesktopGitReviewPullRequestAction,
  updateDesktopGitReviewStage,
}));

import { useDesktopGitReview } from './useDesktopGitReview';

const status = {
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
  pullRequest: null,
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
  message: 'Git repository detected.',
};
const diff = {
  isGitRepository: true,
  workspace: '/workspace',
  repositoryRoot: '/workspace',
  scope: 'uncommitted',
  baseRef: 'main',
  rawDiff: 'diff --git a/src/app.ts b/src/app.ts\n',
  files: [{ path: 'src/app.ts', oldPath: null, status: 'M' }],
  truncated: false,
  message: 'Diff loaded.',
};
const comment = {
  id: 'comment-1',
  workspace: '/workspace',
  path: 'src/app.ts',
  line: 3,
  body: 'Tighten this branch',
  resolved: false,
  createdAt: 1,
  updatedAt: 1,
};

describe('useDesktopGitReview', () => {
  beforeEach(() => {
    for (const fn of [
      addDesktopGitReviewComment,
      getDesktopGitReviewDiff,
      getDesktopGitReviewStatus,
      listDesktopGitReviewComments,
      resolveDesktopGitReviewComment,
      runDesktopGitReviewPullRequestAction,
      updateDesktopGitReviewStage,
      loggerWarn,
    ]) {
      fn.mockReset();
    }
    getDesktopGitReviewStatus.mockResolvedValue(status);
    getDesktopGitReviewDiff.mockResolvedValue(diff);
    listDesktopGitReviewComments.mockResolvedValue({ comments: [comment] });
    resolveDesktopGitReviewComment.mockResolvedValue({ comment: { ...comment, resolved: true } });
    runDesktopGitReviewPullRequestAction.mockResolvedValue({ ok: true, message: 'Review sent.' });
    updateDesktopGitReviewStage.mockResolvedValue({});
  });

  afterEach(cleanup);

  it('selects last-turn threads and runs comment and pull-request actions', async () => {
    const sessions = [
      {
        sessionId: 'code-session',
        title: 'Code task',
        objective: 'Review the latest changes',
        state: 'idle',
        source: 'desktop',
        taskMode: 'code' as const,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const { result } = renderHook(() =>
      useDesktopGitReview({ enabled: true, open: true, sessions })
    );
    await waitFor(() => expect(result.current.status).toEqual(status));

    act(() => result.current.selectScope('lastTurn'));
    expect(result.current.diff).toBeNull();
    expect(result.current.message).toBe('Select a Code thread to review its last turn.');

    await act(async () => result.current.selectThread('code-session'));
    await waitFor(() =>
      expect(getDesktopGitReviewDiff).toHaveBeenLastCalledWith({
        workspace: '/workspace',
        scope: 'lastTurn',
        maxBytes: 256 * 1024,
        threadId: 'code-session',
      })
    );

    await act(async () => result.current.toggleComment(comment));
    expect(resolveDesktopGitReviewComment).toHaveBeenCalledWith({
      commentId: 'comment-1',
      resolved: true,
    });

    act(() => result.current.setReviewBody('  Ship it  '));
    await act(async () => result.current.runPullRequestAction('approve'));
    expect(runDesktopGitReviewPullRequestAction).toHaveBeenCalledWith({
      workspace: '/workspace',
      action: 'approve',
      body: 'Ship it',
    });
    expect(result.current.reviewBody).toBe('');
    expect(result.current.message).toBe('Review sent.');
  });

  it('reports refresh and operation failures', async () => {
    const refreshError = new Error('repository unavailable');
    getDesktopGitReviewStatus.mockRejectedValueOnce(refreshError);
    const { result } = renderHook(() =>
      useDesktopGitReview({ enabled: true, open: true, sessions: [] })
    );
    await waitFor(() => expect(result.current.message).toBe('repository unavailable'));
    expect(loggerWarn).toHaveBeenCalledWith('Failed to refresh desktop git review state', {
      error: refreshError,
    });

    updateDesktopGitReviewStage.mockRejectedValueOnce('stage failed');
    await act(async () => result.current.stageFile('src/app.ts', true));
    expect(result.current.message).toBe('stage failed');
  });
});
