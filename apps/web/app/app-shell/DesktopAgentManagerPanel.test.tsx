import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const createDesktopAppServerAgentSession = mock();
const getDesktopGitReviewDiff = mock();
const getDesktopGitReviewStatus = mock();
const addDesktopGitReviewComment = mock();
const listDesktopGitReviewComments = mock();
const resolveDesktopGitReviewComment = mock();
const runDesktopGitReviewPullRequestAction = mock();
const updateDesktopGitReviewStage = mock();
const getDesktopAppServerEnvironmentStatus = mock();
const handoffDesktopAppServerThread = mock();
const inspectDesktopAppServerDiagnostics = mock();
const listDesktopAppServerAgentSessions = mock();
const listDesktopAppServerChannels = mock();
const listDesktopAppServerSchedules = mock();
const pauseDesktopAppServerAgentSession = mock();
const resumeDesktopAppServerAgentSession = mock();
const cancelDesktopAppServerAgentSession = mock();
const forkDesktopAppServerAgentSession = mock();
const runDesktopAppServerAgentSession = mock();
const tickDesktopAppServerSchedules = mock();
const loggerWarn = mock();

mock.module('../lib/logger', () => ({
  logger: {
    warn: loggerWarn,
  },
}));

mock.module('../lib/platform/desktop/app-server', () => ({
  createDesktopAppServerAgentSession,
  getDesktopGitReviewDiff,
  getDesktopGitReviewStatus,
  addDesktopGitReviewComment,
  listDesktopGitReviewComments,
  resolveDesktopGitReviewComment,
  runDesktopGitReviewPullRequestAction,
  updateDesktopGitReviewStage,
  getDesktopAppServerEnvironmentStatus,
  handoffDesktopAppServerThread,
  inspectDesktopAppServerDiagnostics,
  listDesktopAppServerAgentSessions,
  listDesktopAppServerChannels,
  listDesktopAppServerSchedules,
  pauseDesktopAppServerAgentSession,
  resumeDesktopAppServerAgentSession,
  cancelDesktopAppServerAgentSession,
  forkDesktopAppServerAgentSession,
  runDesktopAppServerAgentSession,
  tickDesktopAppServerSchedules,
}));

import { DesktopAgentManagerPanel } from './DesktopAgentManagerPanel';

const session = {
  sessionId: 'session-1',
  title: 'Investigate flaky tests',
  objective: 'Track down the flaky desktop smoke test',
  state: 'idle',
  runIds: ['run-1'],
  activeRunId: null,
  lastMessage: 'Waiting for the next run',
  lastError: null,
  taskMode: 'work',
};

const resetAppServerMocks = () => {
  listDesktopAppServerAgentSessions.mockResolvedValue({ sessions: [session] });
  listDesktopAppServerChannels.mockResolvedValue({
    channels: [{ id: 'channel-1', name: 'Engineering', kind: 'slack' }],
  });
  listDesktopAppServerSchedules.mockResolvedValue({
    schedules: [{ id: 'schedule-1', name: 'Nightly audit', cadence: 'daily' }],
  });
  getDesktopGitReviewStatus.mockResolvedValue({
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
    pullRequest: {
      number: 42,
      title: 'Wire desktop review pane',
      url: 'https://github.com/taskforceai/taskforceai/pull/42',
      state: 'OPEN',
      headRefName: 'codex/review-pane',
      baseRefName: 'main',
      isDraft: false,
      reviewDecision: 'CHANGES_REQUESTED',
      commentCount: 2,
      reviewCount: 1,
      changedFileCount: 3,
      latestReviews: [
        {
          author: 'reviewer',
          state: 'CHANGES_REQUESTED',
          body: 'Please tighten the tests.',
        },
      ],
    },
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
  });
  getDesktopAppServerEnvironmentStatus.mockResolvedValue({
    active: 'local',
    target: 'workstation',
    localBaseUrl: 'http://127.0.0.1:4100',
    remoteBaseUrl: 'http://127.0.0.1:4200',
    localPort: 4100,
    remotePort: 4200,
    remoteConnected: true,
  });
  handoffDesktopAppServerThread.mockResolvedValue({
    thread: { id: 'session-1', title: session.title, taskMode: 'work' },
    source: 'local',
    target: 'remote',
    sourceArchived: true,
    warning: null,
  });
  listDesktopGitReviewComments.mockResolvedValue({ comments: [] });
  addDesktopGitReviewComment.mockResolvedValue({
    comment: {
      id: 'comment-1',
      workspace: '/workspace',
      path: 'src/app.ts',
      line: 1,
      body: 'Tighten this branch',
      resolved: false,
      createdAt: 1,
      updatedAt: 1,
    },
  });
  resolveDesktopGitReviewComment.mockResolvedValue({ comment: {} });
  runDesktopGitReviewPullRequestAction.mockResolvedValue({
    ok: true,
    message: 'Review sent.',
  });
  updateDesktopGitReviewStage.mockResolvedValue({});
  getDesktopGitReviewDiff.mockResolvedValue({
    isGitRepository: true,
    workspace: '/workspace',
    repositoryRoot: '/workspace',
    scope: 'uncommitted',
    baseRef: 'main',
    rawDiff:
      'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n',
    files: [{ path: 'src/app.ts', oldPath: null, status: 'M' }],
    truncated: false,
    message: 'Git diff loaded.',
  });
  inspectDesktopAppServerDiagnostics.mockResolvedValue({
    sections: [
      {
        title: 'Health',
        items: [{ label: 'Queue', value: 'ready' }],
      },
    ],
  });
  createDesktopAppServerAgentSession.mockResolvedValue({ session });
  pauseDesktopAppServerAgentSession.mockResolvedValue({ session });
  resumeDesktopAppServerAgentSession.mockResolvedValue({ session });
  cancelDesktopAppServerAgentSession.mockResolvedValue({ session });
  forkDesktopAppServerAgentSession.mockResolvedValue({ session });
  runDesktopAppServerAgentSession.mockResolvedValue({ runId: 'run-2' });
  tickDesktopAppServerSchedules.mockResolvedValue({ ticked: 1 });
};

describe('DesktopAgentManagerPanel', () => {
  beforeEach(() => {
    for (const fn of [
      createDesktopAppServerAgentSession,
      getDesktopGitReviewDiff,
      getDesktopGitReviewStatus,
      addDesktopGitReviewComment,
      listDesktopGitReviewComments,
      resolveDesktopGitReviewComment,
      runDesktopGitReviewPullRequestAction,
      updateDesktopGitReviewStage,
      getDesktopAppServerEnvironmentStatus,
      handoffDesktopAppServerThread,
      inspectDesktopAppServerDiagnostics,
      listDesktopAppServerAgentSessions,
      listDesktopAppServerChannels,
      listDesktopAppServerSchedules,
      pauseDesktopAppServerAgentSession,
      resumeDesktopAppServerAgentSession,
      cancelDesktopAppServerAgentSession,
      forkDesktopAppServerAgentSession,
      runDesktopAppServerAgentSession,
      tickDesktopAppServerSchedules,
    ]) {
      fn.mockReset();
    }
    loggerWarn.mockReset();
    resetAppServerMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not load app-server state while closed', () => {
    render(<DesktopAgentManagerPanel open={false} onClose={mock()} />);

    expect(screen.queryByLabelText('Agent manager')).toBeNull();
    expect(listDesktopAppServerAgentSessions).not.toHaveBeenCalled();
  });

  it('loads sessions, channels, schedules, diagnostics, and closes', async () => {
    const onClose = mock();
    render(<DesktopAgentManagerPanel open={true} onClose={onClose} />);

    expect(await screen.findByText('Investigate flaky tests')).toBeTruthy();
    expect(screen.getByText('Track down the flaky desktop smoke test')).toBeTruthy();
    expect((await screen.findAllByText('src/app.ts')).length).toBeGreaterThan(0);
    expect(screen.getByText('PR #42: Wire desktop review pane')).toBeTruthy();
    expect(screen.getAllByText('CHANGES_REQUESTED').length).toBeGreaterThan(0);
    expect(screen.getByText('Engineering · slack')).toBeTruthy();
    expect(screen.getByText('Nightly audit · daily')).toBeTruthy();
    expect(screen.getByText('Health: Queue ready')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('refreshes git review with workspace and selected scope', async () => {
    render(<DesktopAgentManagerPanel open={true} onClose={mock()} />);

    await screen.findAllByText('src/app.ts');
    const user = userEvent.setup({ document: globalThis.document });
    await user.clear(screen.getByLabelText('Workspace'));
    await user.type(screen.getByLabelText('Workspace'), '/tmp/project');
    fireEvent.change(screen.getByLabelText('Review scope'), {
      target: { value: 'staged' },
    });

    await waitFor(() =>
      expect(getDesktopGitReviewDiff).toHaveBeenLastCalledWith({
        workspace: '/tmp/project',
        scope: 'staged',
        maxBytes: 256 * 1024,
      })
    );
    expect(getDesktopGitReviewStatus).toHaveBeenLastCalledWith({
      workspace: '/tmp/project',
    });
  });

  it('stages files and creates line-anchored review threads', async () => {
    render(<DesktopAgentManagerPanel open={true} onClose={mock()} taskMode="code" />);

    await screen.findAllByText('src/app.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }));
    await waitFor(() =>
      expect(updateDesktopGitReviewStage).toHaveBeenCalledWith({
        paths: ['src/app.ts'],
        staged: true,
      })
    );

    const user = userEvent.setup({ document: globalThis.document });
    await user.type(screen.getByLabelText('Review comment body'), 'Tighten this branch');
    fireEvent.click(screen.getByRole('button', { name: 'Add thread' }));
    await waitFor(() =>
      expect(addDesktopGitReviewComment).toHaveBeenCalledWith({
        path: 'src/app.ts',
        line: 1,
        body: 'Tighten this branch',
      })
    );
  });

  it('keeps Git review controls out of Work mode', async () => {
    render(<DesktopAgentManagerPanel open={true} onClose={mock()} taskMode="work" />);

    await screen.findByText('Investigate flaky tests');
    expect(screen.queryByLabelText('Git review')).toBeNull();
    expect(getDesktopGitReviewStatus).not.toHaveBeenCalled();
  });

  it('creates a background session and refreshes the panel', async () => {
    render(<DesktopAgentManagerPanel open={true} onClose={mock()} />);

    await screen.findByText('Investigate flaky tests');
    const user = userEvent.setup({ document: globalThis.document });
    await user.type(screen.getByLabelText('New background session'), 'Run coverage audit');
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    await waitFor(() =>
      expect(createDesktopAppServerAgentSession).toHaveBeenCalledWith({
        objective: 'Run coverage audit',
        source: 'desktop',
        taskMode: 'work',
      })
    );
    await waitFor(() => expect(listDesktopAppServerAgentSessions).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('New background session')).toHaveValue('');
  });

  it('runs sessions and schedules through app-server actions before refreshing', async () => {
    render(<DesktopAgentManagerPanel open={true} onClose={mock()} />);

    await screen.findByText('Investigate flaky tests');

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() =>
      expect(runDesktopAppServerAgentSession).toHaveBeenCalledWith({
        sessionId: 'session-1',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run due schedules' }));
    await waitFor(() => expect(tickDesktopAppServerSchedules).toHaveBeenCalledTimes(1));
    expect(listDesktopAppServerAgentSessions).toHaveBeenCalledTimes(3);
  });

  it('hands off a work thread to the connected environment without changing its mode', async () => {
    render(<DesktopAgentManagerPanel open={true} onClose={mock()} />);

    await screen.findByText('Investigate flaky tests');
    expect(screen.getByText('work mode')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hand off to Remote' }));

    await waitFor(() =>
      expect(handoffDesktopAppServerThread).toHaveBeenCalledWith({
        threadId: 'session-1',
        source: 'local',
        target: 'remote',
      })
    );
    expect(
      await screen.findByText('Investigate flaky tests moved to remote with work mode preserved.')
    ).toBeTruthy();
  });

  it('surfaces refresh failures as panel messages', async () => {
    const error = new Error('app-server unavailable');
    listDesktopAppServerAgentSessions.mockRejectedValueOnce(error);

    render(<DesktopAgentManagerPanel open={true} onClose={mock()} />);

    expect(await screen.findByText('app-server unavailable')).toBeTruthy();
    expect(loggerWarn).toHaveBeenCalledWith('Failed to refresh desktop agent manager state', {
      error,
    });
  });
});
