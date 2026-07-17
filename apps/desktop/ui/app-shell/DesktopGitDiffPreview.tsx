import type {
  AppServerGitReviewComment,
  AppServerGitReviewDiffResult,
} from '../platform/app-server';
import { parseReviewDiff, ReviewCodeSurface, type ReviewCodeSelection } from './ReviewCodeSurface';

export function DesktopGitDiffPreview({
  comments = [],
  diff,
  onSelectRange,
}: {
  comments?: AppServerGitReviewComment[];
  diff: AppServerGitReviewDiffResult | null;
  onSelectRange?: (_selection: ReviewCodeSelection) => void;
}) {
  if (!diff?.isGitRepository) return null;
  if (!diff.rawDiff.trim()) {
    return <p className="mt-3 text-xs text-slate-500">No diff for this scope.</p>;
  }
  if (parseReviewDiff(diff.rawDiff).length === 0) {
    return (
      <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-white/10 bg-slate-950 p-3 text-xs text-slate-300">
        {diff.rawDiff}
      </pre>
    );
  }
  return (
    <ReviewCodeSurface
      comments={comments}
      emptyMessage="The diff could not be structured."
      onSelectRange={onSelectRange}
      rawDiff={diff.rawDiff}
    />
  );
}
