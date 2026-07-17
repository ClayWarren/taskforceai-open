import type { AppServerGitReviewScope } from '../platform/app-server';
import { controlButtonClass } from './desktop-panel-styles';
import { DesktopGitDiffPreview } from './DesktopGitDiffPreview';
import { DesktopInlineReviewThreads } from './DesktopInlineReviewThreads';
import { DesktopPullRequestReview } from './DesktopPullRequestReview';
import type { DesktopGitReviewController } from './useDesktopGitReview';

const REVIEW_SCOPES: Array<{ value: AppServerGitReviewScope; label: string }> = [
  { value: 'uncommitted', label: 'Uncommitted' },
  { value: 'unstaged', label: 'Unstaged' },
  { value: 'staged', label: 'Staged' },
  { value: 'allBranchChanges', label: 'Branch' },
  { value: 'lastTurn', label: 'Last Code turn' },
];

export function DesktopGitReviewPanel({ review }: { review: DesktopGitReviewController }) {
  const {
    addComment,
    commentBody,
    commentEndLine,
    commentLine,
    commentPath,
    comments,
    diff,
    loading,
    message,
    refresh,
    reviewBody,
    runPullRequestAction,
    scope,
    selectScope,
    selectThread,
    sessions,
    setCommentBody,
    setCommentEndLine,
    setCommentLine,
    setCommentPath,
    setReviewBody,
    setWorkspace,
    stageFile,
    status,
    threadId,
    toggleComment,
    workspace,
    workspaceRoots,
  } = review;

  return (
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
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? 'Loading' : 'Refresh'}
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
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
          />
          <datalist id="git-workspace-roots">
            {workspaceRoots.map((root) => (
              <option key={root} value={root} />
            ))}
          </datalist>
        </label>
        <label className="text-xs font-medium text-slate-300" htmlFor="git-review-scope">
          Review scope
          <select
            id="git-review-scope"
            className="mt-1 w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
            value={scope}
            onChange={(event) => selectScope(event.target.value as AppServerGitReviewScope)}
          >
            {REVIEW_SCOPES.map((reviewScope) => (
              <option key={reviewScope.value} value={reviewScope.value}>
                {reviewScope.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {scope === 'lastTurn' ? (
        <label className="mt-3 block text-xs font-medium text-slate-300">
          Code thread
          <select
            aria-label="Last-turn code thread"
            className="mt-1 w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
            value={threadId}
            onChange={(event) => selectThread(event.target.value)}
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
      {status ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="rounded-full border border-white/10 px-2 py-1 text-slate-300">
              {status.isGitRepository ? 'Git repository' : 'No Git repository'}
            </span>
            {status.branch ? <span>{status.branch}</span> : null}
            {status.repositoryRoot ? (
              <span className="truncate font-mono">{status.repositoryRoot}</span>
            ) : (
              <span>{status.workspace}</span>
            )}
          </div>
          {status.files.length > 0 ? (
            <ul className="grid gap-2 text-xs sm:grid-cols-2">
              {status.files.slice(0, 8).map((file) => (
                <li
                  key={`${file.path}-${file.indexStatus ?? ''}-${file.worktreeStatus ?? ''}`}
                  className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-white/10 bg-slate-900/70 px-2 py-1.5"
                >
                  <span className="truncate font-mono text-slate-200">{file.path}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-slate-500">
                      {file.untracked
                        ? 'untracked'
                        : [file.staged ? 'staged' : null, file.unstaged ? 'unstaged' : null]
                            .filter(Boolean)
                            .join(' / ')}
                    </span>
                    <button
                      type="button"
                      className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/10"
                      disabled={loading}
                      onClick={() => void stageFile(file.path, !file.staged)}
                    >
                      {file.staged ? 'Unstage' : 'Stage'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {status.files.length > 8 ? (
            <p className="text-xs text-slate-500">{status.files.length - 8} more files changed.</p>
          ) : null}
          {status.pullRequest ? (
            <DesktopPullRequestReview
              loading={loading}
              onRunAction={runPullRequestAction}
              pullRequest={status.pullRequest}
              reviewBody={reviewBody}
              setReviewBody={setReviewBody}
            />
          ) : null}
        </div>
      ) : null}
      {message ? <p className="mt-3 text-xs text-slate-300">{message}</p> : null}
      <DesktopGitDiffPreview
        comments={comments}
        diff={diff}
        onSelectRange={({ endLine, line, path }) => {
          setCommentPath(path);
          setCommentLine(String(line));
          setCommentEndLine(endLine ? String(endLine) : '');
        }}
      />
      {status ? (
        <DesktopInlineReviewThreads
          commentBody={commentBody}
          commentEndLine={commentEndLine}
          commentLine={commentLine}
          commentPath={commentPath}
          comments={comments}
          loading={loading}
          onAddComment={addComment}
          onToggleComment={toggleComment}
          setCommentBody={setCommentBody}
          setCommentEndLine={setCommentEndLine}
          setCommentLine={setCommentLine}
          setCommentPath={setCommentPath}
          status={status}
        />
      ) : null}
    </section>
  );
}
