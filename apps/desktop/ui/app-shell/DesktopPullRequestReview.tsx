import type {
  AppServerGitReviewPullRequestAction,
  AppServerGitReviewStatusResult,
} from '../platform/app-server';
import { controlButtonClass } from './desktop-panel-styles';

interface DesktopPullRequestReviewProps {
  loading: boolean;
  onRunAction: (_action: AppServerGitReviewPullRequestAction) => void | Promise<void>;
  pullRequest: NonNullable<AppServerGitReviewStatusResult['pullRequest']>;
  reviewBody: string;
  setReviewBody: (_value: string) => void;
}

export function DesktopPullRequestReview({
  loading,
  onRunAction,
  pullRequest,
  reviewBody,
  setReviewBody,
}: DesktopPullRequestReviewProps) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-900/70 p-3 text-xs text-slate-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a
          className="font-medium text-sky-200 hover:text-sky-100"
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
        >
          PR #{pullRequest.number}: {pullRequest.title}
        </a>
        <span className="rounded-full border border-white/10 px-2 py-1 text-slate-400">
          {pullRequest.reviewDecision ?? pullRequest.state ?? 'GitHub'}
        </span>
      </div>
      <p className="mt-2 text-slate-500">
        {pullRequest.headRefName ?? 'head'} into {pullRequest.baseRefName ?? 'base'} ·{' '}
        {pullRequest.changedFileCount} files · {pullRequest.commentCount} comments ·{' '}
        {pullRequest.reviewCount} reviews
      </p>
      {pullRequest.latestReviews?.length ? (
        <ul className="mt-2 space-y-1">
          {pullRequest.latestReviews.slice(0, 3).map((latestReview, index) => (
            <li key={`${latestReview.author ?? 'review'}-${index}`}>
              {latestReview.author ? `${latestReview.author}: ` : ''}
              {latestReview.state ?? 'review'}
              {latestReview.body ? ` - ${latestReview.body}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        aria-label="Pull request review body"
        className="mt-3 min-h-16 w-full resize-y rounded-md border border-white/10 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 outline-none focus:border-sky-400"
        placeholder="Review summary (required for comment or changes requested)"
        value={reviewBody}
        onChange={(event) => setReviewBody(event.target.value)}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={controlButtonClass}
          disabled={!reviewBody.trim() || loading}
          onClick={() => void onRunAction('comment')}
        >
          Comment
        </button>
        <button
          type="button"
          className={controlButtonClass}
          disabled={loading}
          onClick={() => void onRunAction('approve')}
        >
          Approve
        </button>
        <button
          type="button"
          className={controlButtonClass}
          disabled={!reviewBody.trim() || loading}
          onClick={() => void onRunAction('requestChanges')}
        >
          Request changes
        </button>
        {pullRequest.isDraft ? (
          <button
            type="button"
            className={controlButtonClass}
            disabled={loading}
            onClick={() => void onRunAction('markReady')}
          >
            Mark ready
          </button>
        ) : null}
      </div>
    </div>
  );
}
