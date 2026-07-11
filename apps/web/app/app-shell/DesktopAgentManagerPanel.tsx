'use client';

import { useCallback, useEffect, useState } from 'react';

import { parseDiffPreview } from '@taskforceai/presenters/tool-usage/parsers';

import { logger } from '../lib/logger';
import {
  createDesktopAppServerAgentSession,
  getDesktopGitReviewDiff,
  getDesktopGitReviewStatus,
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
  type AppServerAgentSession,
  type AppServerChannel,
  type AppServerDiagnosticSection,
  type AppServerGitReviewDiffResult,
  type AppServerGitReviewScope,
  type AppServerGitReviewStatusResult,
  type AppServerSchedule,
} from '../lib/platform/desktop/app-server';
import { DiffPreview } from '../components/tool-usage/DiffPreview';

interface DesktopAgentManagerPanelProps {
  open: boolean;
  onClose: () => void;
}

export function DesktopAgentManagerPanel({ open, onClose }: DesktopAgentManagerPanelProps) {
  const [sessions, setSessions] = useState<AppServerAgentSession[]>([]);
  const [channels, setChannels] = useState<AppServerChannel[]>([]);
  const [schedules, setSchedules] = useState<AppServerSchedule[]>([]);
  const [diagnostics, setDiagnostics] = useState<AppServerDiagnosticSection[]>([]);
  const [gitWorkspace, setGitWorkspace] = useState('');
  const [gitScope, setGitScope] = useState<AppServerGitReviewScope>('Uncommitted');
  const [gitStatus, setGitStatus] = useState<AppServerGitReviewStatusResult | null>(null);
  const [gitDiff, setGitDiff] = useState<AppServerGitReviewDiffResult | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitReviewAttempted, setGitReviewAttempted] = useState(false);
  const [gitMessage, setGitMessage] = useState<string | null>(null);
  const [objective, setObjective] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [agentList, channelList, scheduleList, inspection] = await Promise.all([
      listDesktopAppServerAgentSessions(),
      listDesktopAppServerChannels(),
      listDesktopAppServerSchedules(),
      inspectDesktopAppServerDiagnostics(),
    ]);
    setSessions(agentList.sessions);
    setChannels(channelList.channels);
    setSchedules(scheduleList.schedules);
    setDiagnostics(inspection.sections);
  }, []);

  const loadGitReview = useCallback(
    async (scope: AppServerGitReviewScope, workspaceValue: string) => {
      const workspace = workspaceValue.trim();
      const workspaceParams = workspace ? { workspace } : {};
      try {
        setGitReviewAttempted(true);
        setGitLoading(true);
        setGitMessage(null);
        const [status, diff] = await Promise.all([
          getDesktopGitReviewStatus(workspaceParams),
          getDesktopGitReviewDiff({
            ...workspaceParams,
            scope,
            maxBytes: 256 * 1024,
          }),
        ]);
        setGitStatus(status);
        setGitDiff(diff);
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
    () => loadGitReview(gitScope, gitWorkspace),
    [gitScope, gitWorkspace, loadGitReview]
  );

  useEffect(() => {
    if (!open) return;
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
    if (!open || gitReviewAttempted || gitStatus || gitLoading) return;
    void refreshGitReview();
  }, [open, gitReviewAttempted, gitStatus, gitLoading, refreshGitReview]);

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
                    className="mt-1 w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
                    placeholder="Current app-server directory"
                    value={gitWorkspace}
                    onChange={(event) => setGitWorkspace(event.target.value)}
                  />
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
                      void loadGitReview(nextScope, gitWorkspace);
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
                          <span className="shrink-0 text-slate-500">
                            {file.untracked
                              ? 'untracked'
                              : [file.staged ? 'staged' : null, file.unstaged ? 'unstaged' : null]
                                  .filter(Boolean)
                                  .join(' / ')}
                          </span>
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
                          {gitStatus.pullRequest.latestReviews.slice(0, 3).map((review, index) => (
                            <li key={`${review.author ?? 'review'}-${index}`}>
                              {review.author ? `${review.author}: ` : ''}
                              {review.state ?? 'review'}
                              {review.body ? ` - ${review.body}` : ''}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {gitMessage ? <p className="mt-3 text-xs text-slate-300">{gitMessage}</p> : null}
              <GitDiffPreview diff={gitDiff} />
            </section>

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
                              runDesktopAppServerAgentSession({ sessionId: session.sessionId })
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
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>

          <aside className="space-y-4">
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

const GIT_REVIEW_SCOPES: Array<{ value: AppServerGitReviewScope; label: string }> = [
  { value: 'Uncommitted', label: 'Uncommitted' },
  { value: 'Unstaged', label: 'Unstaged' },
  { value: 'Staged', label: 'Staged' },
  { value: 'AllBranchChanges', label: 'Branch' },
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
