'use client';

import {
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  LaptopMinimal,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SourceReference } from '@taskforceai/client-core/types';
import {
  PinnedSummaryPanel,
  PinnedSummarySection,
  PinnedSummarySources,
  pinnedSummaryRowClass,
} from '@taskforceai/web/app/app-shell/shell/PinnedSummaryCard';
import { readDesktopCodeWorkspaceRoots } from '@taskforceai/web/app/lib/desktop/task-mode';
import { logger } from '@taskforceai/web/app/lib/logger';
import {
  getDesktopGitReviewDiff,
  getDesktopGitReviewStatus,
  type AppServerGitReviewDiffResult,
  type AppServerGitReviewStatusResult,
} from '../platform/app-server';

export const countDesktopDiffLines = (rawDiff: string) => {
  let additions = 0;
  let deletions = 0;
  for (const line of rawDiff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
};

export function DesktopCodePinnedSummary({
  sources,
  onOpenEnvironment,
  onReviewChanges,
}: {
  sources: SourceReference[];
  onOpenEnvironment: () => void;
  onReviewChanges: () => void;
}) {
  const [status, setStatus] = useState<AppServerGitReviewStatusResult | null>(null);
  const [diff, setDiff] = useState<AppServerGitReviewDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const workspace = readDesktopCodeWorkspaceRoots()[0];

  const refresh = useCallback(async () => {
    if (!workspace) {
      setStatus(null);
      setDiff(null);
      return;
    }
    try {
      setLoading(true);
      const workspaceParams = { workspace };
      const [nextStatus, nextDiff] = await Promise.all([
        getDesktopGitReviewStatus(workspaceParams),
        getDesktopGitReviewDiff({
          ...workspaceParams,
          scope: 'allBranchChanges',
          maxBytes: 512 * 1024,
        }),
      ]);
      setStatus(nextStatus);
      setDiff(nextDiff);
    } catch (error) {
      logger.warn('Failed to refresh the desktop pinned Code summary', { error });
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const stats = useMemo(() => countDesktopDiffLines(diff?.rawDiff ?? ''), [diff?.rawDiff]);
  const branch = status?.branch || 'Local';

  return (
    <PinnedSummaryPanel>
      <PinnedSummarySection
        title="Environment"
        action={
          <button
            type="button"
            className="rounded-md p-1 text-slate-400 transition hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:outline-none"
            onClick={onOpenEnvironment}
            aria-label="Open Code environment"
          >
            <Plus aria-hidden="true" size={18} />
          </button>
        }
      >
        <div className="space-y-0.5">
          <button type="button" className={pinnedSummaryRowClass} onClick={onReviewChanges}>
            <GitCompareArrows aria-hidden="true" className="text-slate-300" size={18} />
            <span>Changes</span>
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[14px]">
              <span className="text-emerald-300">+{stats.additions}</span>
              <span className="text-rose-300">-{stats.deletions}</span>
            </span>
          </button>
          <div className={pinnedSummaryRowClass}>
            <LaptopMinimal aria-hidden="true" className="text-slate-300" size={18} />
            <span>Local</span>
          </div>
          <div className={pinnedSummaryRowClass}>
            <GitBranch aria-hidden="true" className="text-slate-300" size={18} />
            <span className="min-w-0 truncate">{branch}</span>
          </div>
          <button type="button" className={pinnedSummaryRowClass} onClick={onReviewChanges}>
            <GitCommitHorizontal aria-hidden="true" className="text-slate-300" size={18} />
            <span>Commit or push</span>
          </button>
          <button type="button" className={pinnedSummaryRowClass} onClick={onReviewChanges}>
            {loading ? (
              <RefreshCw aria-hidden="true" className="animate-spin text-slate-300" size={18} />
            ) : (
              <GitCompareArrows aria-hidden="true" className="text-slate-300" size={18} />
            )}
            <span>Compare branch</span>
            <ExternalLink aria-hidden="true" className="ml-auto text-slate-500" size={14} />
          </button>
        </div>
      </PinnedSummarySection>
      <PinnedSummarySources sources={sources} />
    </PinnedSummaryPanel>
  );
}
