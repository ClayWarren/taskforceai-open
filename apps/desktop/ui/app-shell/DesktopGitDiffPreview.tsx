import { parseDiffPreview } from '@taskforceai/presenters/tool-usage/parsers';

import { DiffPreview } from '@taskforceai/web/app/components/tool-usage/DiffPreview';
import type { AppServerGitReviewDiffResult } from '../platform/app-server';

export function DesktopGitDiffPreview({ diff }: { diff: AppServerGitReviewDiffResult | null }) {
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
