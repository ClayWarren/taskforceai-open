'use client';

import { useCallback, useEffect, useState } from 'react';

import { parseDiffPreview } from '@taskforceai/presenters/tool-usage/parsers';

import { logger } from '../lib/logger';
import { readDesktopCodeWorkspaceRoots, type DesktopTaskMode } from '../lib/desktop/task-mode';
import {
  createDesktopAppServerAgentSession,
  addDesktopGitReviewComment,
  getDesktopGitReviewDiff,
  getDesktopGitReviewStatus,
  getDesktopAppServerEnvironmentStatus,
  handoffDesktopAppServerThread,
  inspectDesktopAppServerDiagnostics,
  listDesktopGitReviewComments,
  listDesktopAppServerAgentSessions,
  listDesktopAppServerChannels,
  listDesktopAppServerSchedules,
  pauseDesktopAppServerAgentSession,
  resumeDesktopAppServerAgentSession,
  cancelDesktopAppServerAgentSession,
  forkDesktopAppServerAgentSession,
  runDesktopAppServerAgentSession,
  runDesktopGitReviewPullRequestAction,
  resolveDesktopGitReviewComment,
  tickDesktopAppServerSchedules,
  updateDesktopGitReviewStage,
  type AppServerAgentSession,
  type AppServerEnvironmentStatus,
  type AppServerChannel,
  type AppServerDiagnosticSection,
  type AppServerGitReviewDiffResult,
  type AppServerGitReviewComment,
  type AppServerGitReviewPullRequestAction,
  type AppServerGitReviewScope,
  type AppServerGitReviewStatusResult,
  type AppServerSchedule,
} from '../lib/platform/desktop/app-server';
import { DiffPreview } from '../components/tool-usage/DiffPreview';

interface DesktopAgentManagerPanelProps {
  open: boolean;
  onClose: () => void;
  taskMode?: DesktopTaskMode;
}

// eslint-disable-next-line complexity -- The panel coordinates independent agent, schedule, and Git review states.
export function DesktopAgentManagerPanel({
  open,
  onClose,
  taskMode = 'code',
}: DesktopAgentManagerPanelProps) {
  const [sessions, setSessions] = useState<AppServerAgentSession[]>([]);
  const [environment, setEnvironment] = useState<AppServerEnvironmentStatus | null>(null);
  const [channels, setChannels] = useState<AppServerChannel[]>([]);
  const [schedules, setSchedules] = useState<AppServerSchedule[]>([]);
  const [diagnostics, setDiagnostics] = useState<AppServerDiagnosticSection[]>([]);
  const [gitWorkspace, setGitWorkspace] = useState('');
  const [gitWorkspaceRoots, setGitWorkspaceRoots] = useState<string[]>([]);
  const [gitScope, setGitScope] = useState<AppServerGitReviewScope>('uncommitted');
  const [gitStatus, setGitStatus] = useState<AppServerGitReviewStatusResult | null>(null);
  const [gitDiff, setGitDiff] = useState<AppServerGitReviewDiffResult | null>(null);
  const [gitComments, setGitComments] = useState<AppServerGitReviewComment[]>([]);
  const [gitThreadId, setGitThreadId] = useState('');
  const [gitCommentPath, setGitCommentPath] = useState('');
  const [gitCommentLine, setGitCommentLine] = useState('1');
  const [gitCommentEndLine, setGitCommentEndLine] = useState('');
  const [gitCommentBody, setGitCommentBody] = useState('');
  const [gitReviewBody, setGitReviewBody] = useState('');
  const [gitLoading, setGitLoading] = useState(false);
  const [gitReviewAttempted, setGitReviewAttempted] = useState(false);
  const [gitMessage, setGitMessage] = useState<string | null>(null);
  const [objective, setObjective] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [agentList, channelList, scheduleList, inspection, environmentStatus] = await Promise.all(
      [
        listDesktopAppServerAgentSessions(),
        listDesktopAppServerChannels(),
        listDesktopAppServerSchedules(),
        inspectDesktopAppServerDiagnostics(),
        getDesktopAppServerEnvironmentStatus(),
      ]
    );
    setSessions(agentList.sessions);
    setChannels(channelList.channels);
    setSchedules(scheduleList.schedules);
    setDiagnostics(inspection.sections);
    setEnvironment(environmentStatus);
  }, []);

  const loadGitReview = useCallback(
    async (scope: AppServerGitReviewScope, workspaceValue: string, threadId: string) => {
      const workspace = workspaceValue.trim();
      const workspaceParams = workspace ? { workspace } : {};
      try {
        setGitReviewAttempted(true);
        setGitLoading(true);
        setGitMessage(null);
        const [status, diff, comments] = await Promise.all([
          getDesktopGitReviewStatus(workspaceParams),
          getDesktopGitReviewDiff({
            ...workspaceParams,
            scope,
            maxBytes: 256 * 1024,
            ...(scope === 'lastTurn' && threadId ? { threadId } : {}),
          }),
          listDesktopGitReviewComments(workspaceParams).catch(() => ({
            comments: [],
          })),
        ]);
        setGitStatus(status);
        setGitDiff(diff);
        setGitComments(comments.comments);
        setGitCommentPath((current) => current || status.files[0]?.path || '');
        if (!status.isGitRepository) {
          setGitMessage(status.message);
        } else if (diff.truncated) {
          setGitMessage('Diff truncated to the first 256 KB.');
        }
      } catch (error) {
        logger.warn('Failed to refresh desktop git review state', { error });
        setGitMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setGitLoading(false);
      }
    },
    []
  );

  const refreshGitReview = useCallback(
    () => loadGitReview(gitScope, gitWorkspace, gitThreadId),
    [gitScope, gitWorkspace, gitThreadId, loadGitReview]
  );

  useEffect(() => {
    if (!open) return;
    const roots = readDesktopCodeWorkspaceRoots();
    setGitWorkspaceRoots(roots);
    setGitWorkspace((current) => current || roots[0] || '');
    let active = true;
    void refresh().catch((error) => {
      logger.warn('Failed to refresh desktop agent manager state', { error });
      if (active) setMessage(error instanceof Error ? error.message : String(error));
    });
    const interval = window.setInterval(() => {
      void refresh().catch((error) => {
        logger.warn('Failed to refresh desktop agent manager state', { error });
        if (active) setMessage(error instanceof Error ? error.message : String(error));
      });
    }, 5_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [open, refresh]);

  useEffect(() => {
    if (taskMode !== 'code' || !open || gitReviewAttempted || gitStatus || gitLoading) return;
    void refreshGitReview();
  }, [taskMode, open, gitReviewAttempted, gitStatus, gitLoading, refreshGitReview]);

  useEffect(() => {
    if (open) return;
    setGitReviewAttempted(false);
  }, [open]);

  if (!open) return null;

  const runAndRefresh = async (operation: () => Promise<unknown>) => {
    try {
      setMessage(null);
      await operation();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handoffAndRefresh = async (threadId: string) => {
    if (!environment?.remoteConnected) return;
    const source = environment.active === 'remote' ? 'remote' : 'local';
    const target = source === 'local' ? 'remote' : 'local';
    try {
      setMessage(null);
      setHandoffMessage(null);
      const result = await handoffDesktopAppServerThread({
        threadId,
        source,
        target,
      });
      setHandoffMessage(
        result.warning ??
          `${result.thread.title} moved to ${target} with ${result.thread.taskMode} mode preserved.`
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const runGitOperation = async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    try {
      setGitLoading(true);
      setGitMessage(null);
      const result = await operation();
      await refreshGitReview();
      return result;
    } catch (error) {
      setGitMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setGitLoading(false);
    }
  };

  const gitWorkspaceParams = gitWorkspace.trim() ? { workspace: gitWorkspace.trim() } : {};

  const addReviewComment = async () => {
    const line = Number.parseInt(gitCommentLine, 10);
    const endLine = gitCommentEndLine.trim() ? Number.parseInt(gitCommentEndLine, 10) : undefined;
    if (!gitCommentPath || !Number.isFinite(line) || line < 1 || !gitCommentBody.trim()) return;
    await runGitOperation(async () => {
      await addDesktopGitReviewComment({
        ...gitWorkspaceParams,
        path: gitCommentPath,
        line,
        ...(endLine ? { endLine } : {}),
        body: gitCommentBody.trim(),
      });
      setGitCommentBody('');
    });
  };

  const runPullRequestAction = async (action: AppServerGitReviewPullRequestAction) => {
    const result = await runGitOperation(() =>
      runDesktopGitReviewPullRequestAction({
        ...gitWorkspaceParams,
        action,
        ...(gitReviewBody.trim() ? { body: gitReviewBody.trim() } : {}),
      })
    );
    if (result) {
      setGitMessage(result.message);
      if (action !== 'markReady') setGitReviewBody('');
    }
  };

  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
      <section
        className="max-h-[86vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950 text-slate-100 shadow-2xl"
        aria-label="Agent manager"
      >
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Agent Manager</h2>
            <p className="mt-1 text-xs text-slate-400">
              Local app-server sessions, channels, schedules, and diagnostics.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="grid max-h-[calc(86vh-76px)] gap-4 overflow-y-auto p-5 lg:grid-cols-[1.35fr_0.9fr]">
          <div className="space-y-4">
            {taskMode === 'code' ? (
              <section
                className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
                aria-label="Git review"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">Git Review</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      Inspect repository changes before committing.
                    </p>
                  </div>
                  <button
                    type="button"
                    className={controlButtonClass}
                    onClick={() => void refreshGitReview()}
                    disabled={gitLoading}
                  >
                    {gitLoading ? 'Loading' : 'Refresh'}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
                  <label className="text-xs font-medium text-slate-300" htmlFor="git-workspace">
                    Workspace
                    <input
                      id="git-workspace"
                      list="git-workspace-roots"
                      className="mt-1 w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
                      placeholder="Current app-server directory"
                      value={gitWorkspace}
                      onChange={(event) => setGitWorkspace(event.target.value)}
                    />
                    <datalist id="git-workspace-roots">
                      {gitWorkspaceRoots.map((root) => (
                        <option key={root} value={root} />
                      ))}
                    </datalist>
                  </label>
                  <label className="text-xs font-medium text-slate-300" htmlFor="git-review-scope">
                    Review scope
                    <select
                      id="git-review-scope"
                      className="mt-1 w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
                      value={gitScope}
                      onChange={(event) => {
                        const nextScope = event.target.value as AppServerGitReviewScope;
                        setGitScope(nextScope);
                        if (nextScope === 'lastTurn' && !gitThreadId) {
                          setGitDiff(null);
                          setGitMessage('Select a Code thread to review its last turn.');
                          return;
                        }
                        void loadGitReview(nextScope, gitWorkspace, gitThreadId);
                      }}
                    >
                      {GIT_REVIEW_SCOPES.map((scope) => (
                        <option key={scope.value} value={scope.value}>
                          {scope.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {gitScope === 'lastTurn' ? (
                  <label className="mt-3 block text-xs font-medium text-slate-300">
                    Code thread
                    <select
                      aria-label="Last-turn code thread"
                      className="mt-1 w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
                      value={gitThreadId}
                      onChange={(event) => {
                        setGitThreadId(event.target.value);
                        void loadGitReview('lastTurn', gitWorkspace, event.target.value);
                      }}
                    >
                      <option value="">Select a Code thread</option>
                      {sessions
                        .filter((session) => session.taskMode === 'code')
                        .map((session) => (
                          <option key={session.sessionId} value={session.sessionId}>
                            {session.title}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}
                {gitStatus ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="rounded-full border border-white/10 px-2 py-1 text-slate-300">
                        {gitStatus.isGitRepository ? 'Git repository' : 'No Git repository'}
                      </span>
                      {gitStatus.branch ? <span>{gitStatus.branch}</span> : null}
                      {gitStatus.repositoryRoot ? (
                        <span className="truncate font-mono">{gitStatus.repositoryRoot}</span>
                      ) : (
                        <span>{gitStatus.workspace}</span>
                      )}
                    </div>
                    {gitStatus.files.length > 0 ? (
                      <ul className="grid gap-2 text-xs sm:grid-cols-2">
                        {gitStatus.files.slice(0, 8).map((file) => (
                          <li
                            key={`${file.path}-${file.indexStatus ?? ''}-${file.worktreeStatus ?? ''}`}
                            className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-white/10 bg-slate-900/70 px-2 py-1.5"
                          >
                            <span className="truncate font-mono text-slate-200">{file.path}</span>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-slate-500">
                                {file.untracked
                                  ? 'untracked'
                                  : [
                                      file.staged ? 'staged' : null,
                                      file.unstaged ? 'unstaged' : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' / ')}
                              </span>
                              <button
                                type="button"
                                className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/10"
                                disabled={gitLoading}
                                onClick={() =>
                                  void runGitOperation(() =>
                                    updateDesktopGitReviewStage({
                                      ...gitWorkspaceParams,
                                      paths: [file.path],
                                      staged: !file.staged,
                                    })
                                  )
                                }
                              >
                                {file.staged ? 'Unstage' : 'Stage'}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {gitStatus.files.length > 8 ? (
                      <p className="text-xs text-slate-500">
                        {gitStatus.files.length - 8} more files changed.
                      </p>
                    ) : null}
                    {gitStatus.pullRequest ? (
                      <div className="rounded-md border border-white/10 bg-slate-900/70 p-3 text-xs text-slate-300">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <a
                            className="font-medium text-sky-200 hover:text-sky-100"
                            href={gitStatus.pullRequest.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            PR #{gitStatus.pullRequest.number}: {gitStatus.pullRequest.title}
                          </a>
                          <span className="rounded-full border border-white/10 px-2 py-1 text-slate-400">
                            {gitStatus.pullRequest.reviewDecision ??
                              gitStatus.pullRequest.state ??
                              'GitHub'}
                          </span>
                        </div>
                        <p className="mt-2 text-slate-500">
                          {gitStatus.pullRequest.headRefName ?? 'head'} into{' '}
                          {gitStatus.pullRequest.baseRefName ?? 'base'} ·{' '}
                          {gitStatus.pullRequest.changedFileCount} files ·{' '}
                          {gitStatus.pullRequest.commentCount} comments ·{' '}
                          {gitStatus.pullRequest.reviewCount} reviews
                        </p>
                        {gitStatus.pullRequest.latestReviews?.length ? (
                          <ul className="mt-2 space-y-1">
                            {gitStatus.pullRequest.latestReviews
                              .slice(0, 3)
                              .map((review, index) => (
                                <li key={`${review.author ?? 'review'}-${index}`}>
                                  {review.author ? `${review.author}: ` : ''}
                                  {review.state ?? 'review'}
                                  {review.body ? ` - ${review.body}` : ''}
                                </li>
                              ))}
                          </ul>
                        ) : null}
                        <textarea
                          aria-label="Pull request review body"
                          className="mt-3 min-h-16 w-full resize-y rounded-md border border-white/10 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 outline-none focus:border-sky-400"
                          placeholder="Review summary (required for comment or changes requested)"
                          value={gitReviewBody}
                          onChange={(event) => setGitReviewBody(event.target.value)}
                        />
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={controlButtonClass}
                            disabled={!gitReviewBody.trim() || gitLoading}
                            onClick={() => void runPullRequestAction('comment')}
                          >
                            Comment
                          </button>
                          <button
                            type="button"
                            className={controlButtonClass}
                            disabled={gitLoading}
                            onClick={() => void runPullRequestAction('approve')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className={controlButtonClass}
                            disabled={!gitReviewBody.trim() || gitLoading}
                            onClick={() => void runPullRequestAction('requestChanges')}
                          >
                            Request changes
                          </button>
                          {gitStatus.pullRequest.isDraft ? (
                            <button
                              type="button"
                              className={controlButtonClass}
                              disabled={gitLoading}
                              onClick={() => void runPullRequestAction('markReady')}
                            >
                              Mark ready
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {gitMessage ? <p className="mt-3 text-xs text-slate-300">{gitMessage}</p> : null}
                <GitDiffPreview diff={gitDiff} />
                {gitStatus?.isGitRepository ? (
                  <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
                    <h4 className="text-xs font-semibold text-slate-200">Inline review threads</h4>
                    <div className="grid gap-2 sm:grid-cols-[1fr_76px_76px]">
                      <select
                        aria-label="Review comment file"
                        className="rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                        value={gitCommentPath}
                        onChange={(event) => setGitCommentPath(event.target.value)}
                      >
                        <option value="">Select file</option>
                        {gitStatus.files.map((file) => (
                          <option key={file.path} value={file.path}>
                            {file.path}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Review comment start line"
                        type="number"
                        min={1}
                        className="rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                        value={gitCommentLine}
                        onChange={(event) => setGitCommentLine(event.target.value)}
                      />
                      <input
                        aria-label="Review comment end line"
                        type="number"
                        min={1}
                        placeholder="End"
                        className="rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                        value={gitCommentEndLine}
                        onChange={(event) => setGitCommentEndLine(event.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <input
                        aria-label="Review comment body"
                        className="min-w-0 flex-1 rounded-md border border-white/10 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                        placeholder="Comment on this line or range"
                        value={gitCommentBody}
                        onChange={(event) => setGitCommentBody(event.target.value)}
                      />
                      <button
                        type="button"
                        className={primaryControlButtonClass}
                        disabled={!gitCommentPath || !gitCommentBody.trim() || gitLoading}
                        onClick={() => void addReviewComment()}
                      >
                        Add thread
                      </button>
                    </div>
                    {gitComments.length ? (
                      <ul className="space-y-2">
                        {gitComments.map((comment) => (
                          <li
                            key={comment.id}
                            className="rounded-md border border-white/10 bg-slate-900/70 p-2 text-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-mono text-sky-200">
                                  {comment.path}:{comment.line}
                                  {comment.endLine && comment.endLine !== comment.line
                                    ? `-${comment.endLine}`
                                    : ''}
                                </p>
                                <p className="mt-1 text-slate-300">{comment.body}</p>
                              </div>
                              <button
                                type="button"
                                className={controlButtonClass}
                                onClick={() =>
                                  void runGitOperation(() =>
                                    resolveDesktopGitReviewComment({
                                      commentId: comment.id,
                                      resolved: !comment.resolved,
                                    })
                                  )
                                }
                              >
                                {comment.resolved ? 'Reopen' : 'Resolve'}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">No review threads yet.</p>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}

            <form
              className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const trimmed = objective.trim();
                if (!trimmed) return;
                void runAndRefresh(async () => {
                  await createDesktopAppServerAgentSession({
                    objective: trimmed,
                    source: 'desktop',
                    taskMode: 'work',
                  });
                  setObjective('');
                });
              }}
            >
              <label className="text-sm font-medium text-slate-200" htmlFor="agent-objective">
                New background session
              </label>
              <textarea
                id="agent-objective"
                className="mt-3 min-h-24 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
              />
              <button
                type="submit"
                className="mt-3 rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
              >
                Start session
              </button>
            </form>

            <div className="space-y-3">
              {sessions.length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                  No local agent sessions yet.
                </p>
              ) : (
                sessions.map((session) => {
                  const runIds = session.runIds ?? [];
                  return (
                    <article
                      key={session.sessionId}
                      className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">{session.title}</h3>
                          <p className="mt-1 text-[11px] font-medium tracking-wide text-sky-300 uppercase">
                            {session.taskMode ?? 'chat'} mode
                          </p>
                          <p className="mt-1 text-sm text-slate-300">{session.objective}</p>
                          {session.lastMessage ? (
                            <p className="mt-2 text-xs text-slate-400">{session.lastMessage}</p>
                          ) : null}
                          <p className="mt-2 text-xs text-slate-500">
                            {session.activeRunId
                              ? `active run ${session.activeRunId}`
                              : `${runIds.length} run${runIds.length === 1 ? '' : 's'}`}
                          </p>
                          {session.lastError ? (
                            <p className="mt-2 text-xs text-red-200">{session.lastError}</p>
                          ) : null}
                        </div>
                        <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300">
                          {session.state}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={primaryControlButtonClass}
                          onClick={() =>
                            void runAndRefresh(() =>
                              runDesktopAppServerAgentSession({
                                sessionId: session.sessionId,
                              })
                            )
                          }
                        >
                          Run
                        </button>
                        <button
                          type="button"
                          className={controlButtonClass}
                          onClick={() =>
                            void runAndRefresh(() =>
                              pauseDesktopAppServerAgentSession(session.sessionId)
                            )
                          }
                        >
                          Pause
                        </button>
                        <button
                          type="button"
                          className={controlButtonClass}
                          onClick={() =>
                            void runAndRefresh(() =>
                              resumeDesktopAppServerAgentSession(session.sessionId)
                            )
                          }
                        >
                          Resume
                        </button>
                        <button
                          type="button"
                          className={controlButtonClass}
                          onClick={() =>
                            void runAndRefresh(() =>
                              forkDesktopAppServerAgentSession(session.sessionId)
                            )
                          }
                        >
                          Fork
                        </button>
                        <button
                          type="button"
                          className={controlButtonClass}
                          onClick={() =>
                            void runAndRefresh(() =>
                              cancelDesktopAppServerAgentSession(session.sessionId)
                            )
                          }
                        >
                          Cancel
                        </button>
                        {environment?.remoteConnected ? (
                          <button
                            type="button"
                            className={controlButtonClass}
                            onClick={() => void handoffAndRefresh(session.sessionId)}
                          >
                            Hand off to {environment.active === 'remote' ? 'Local' : 'Remote'}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>

          <aside className="space-y-4">
            {handoffMessage ? (
              <p className="rounded-lg border border-sky-400/30 bg-sky-500/10 p-3 text-sm text-sky-100">
                {handoffMessage}
              </p>
            ) : null}
            {message ? (
              <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
                {message}
              </p>
            ) : null}
            <SummaryBlock
              title="Channels"
              rows={channels.map((channel) => `${channel.name} · ${channel.kind}`)}
            />
            <SummaryBlock
              title="Schedules"
              rows={schedules.map((schedule) => `${schedule.name} · ${schedule.cadence}`)}
            />
            <button
              type="button"
              className="w-full rounded-md border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
              onClick={() => void runAndRefresh(() => tickDesktopAppServerSchedules())}
            >
              Run due schedules
            </button>
            <SummaryBlock
              title="Diagnostics"
              rows={diagnostics.flatMap((section) =>
                section.items
                  .slice(0, 3)
                  .map((item) => `${section.title}: ${item.label} ${item.value}`)
              )}
            />
          </aside>
        </div>
      </section>
    </div>
  );
}

const controlButtonClass =
  'rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10';

const primaryControlButtonClass =
  'rounded-md bg-sky-500 px-2.5 py-1.5 text-xs font-medium text-slate-950 hover:bg-sky-400';

const GIT_REVIEW_SCOPES: Array<{
  value: AppServerGitReviewScope;
  label: string;
}> = [
  { value: 'uncommitted', label: 'Uncommitted' },
  { value: 'unstaged', label: 'Unstaged' },
  { value: 'staged', label: 'Staged' },
  { value: 'allBranchChanges', label: 'Branch' },
  { value: 'lastTurn', label: 'Last Code turn' },
];

function GitDiffPreview({ diff }: { diff: AppServerGitReviewDiffResult | null }) {
  if (!diff?.isGitRepository) return null;
  if (!diff.rawDiff.trim()) {
    return <p className="mt-3 text-xs text-slate-500">No diff for this scope.</p>;
  }
  const preview = parseDiffPreview(diff.rawDiff);
  if (!preview) {
    return (
      <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-white/10 bg-slate-950 p-3 text-xs text-slate-300">
        {diff.rawDiff}
      </pre>
    );
  }
  return <DiffPreview diff={preview} maxLinesPerFile={40} />;
}

function SummaryBlock({ title, rows }: { title: string; rows: string[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">None yet.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm text-slate-300">
          {rows.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
