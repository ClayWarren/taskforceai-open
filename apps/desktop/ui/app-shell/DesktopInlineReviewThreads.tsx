import type {
  AppServerGitReviewComment,
  AppServerGitReviewStatusResult,
} from '../platform/app-server';
import { controlButtonClass, primaryControlButtonClass } from './desktop-panel-styles';

interface DesktopInlineReviewThreadsProps {
  commentBody: string;
  commentEndLine: string;
  commentLine: string;
  commentPath: string;
  comments: AppServerGitReviewComment[];
  loading: boolean;
  onAddComment: () => void | Promise<void>;
  onToggleComment: (_comment: AppServerGitReviewComment) => void | Promise<unknown>;
  setCommentBody: (_value: string) => void;
  setCommentEndLine: (_value: string) => void;
  setCommentLine: (_value: string) => void;
  setCommentPath: (_value: string) => void;
  status: AppServerGitReviewStatusResult;
}

export function DesktopInlineReviewThreads({
  commentBody,
  commentEndLine,
  commentLine,
  commentPath,
  comments,
  loading,
  onAddComment,
  onToggleComment,
  setCommentBody,
  setCommentEndLine,
  setCommentLine,
  setCommentPath,
  status,
}: DesktopInlineReviewThreadsProps) {
  if (!status.isGitRepository) return null;

  return (
    <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
      <h4 className="text-xs font-semibold text-slate-200">Inline review threads</h4>
      <div className="grid gap-2 sm:grid-cols-[1fr_76px_76px]">
        <select
          aria-label="Review comment file"
          className="rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
          value={commentPath}
          onChange={(event) => setCommentPath(event.target.value)}
        >
          <option value="">Select file</option>
          {status.files.map((file) => (
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
          value={commentLine}
          onChange={(event) => setCommentLine(event.target.value)}
        />
        <input
          aria-label="Review comment end line"
          type="number"
          min={1}
          placeholder="End"
          className="rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
          value={commentEndLine}
          onChange={(event) => setCommentEndLine(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <input
          aria-label="Review comment body"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
          placeholder="Comment on this line or range"
          value={commentBody}
          onChange={(event) => setCommentBody(event.target.value)}
        />
        <button
          type="button"
          className={primaryControlButtonClass}
          disabled={!commentPath || !commentBody.trim() || loading}
          onClick={() => void onAddComment()}
        >
          Add thread
        </button>
      </div>
      {comments.length ? (
        <ul className="space-y-2">
          {comments.map((comment) => (
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
                  onClick={() => void onToggleComment(comment)}
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
  );
}
