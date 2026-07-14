'use client';

import { parseDiffPreview } from '@taskforceai/presenters/tool-usage/parsers';
import {
  Files,
  GitCompareArrows,
  Globe2,
  LayoutPanelTop,
  PanelRightClose,
  SearchCode,
  SquareTerminal,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DiffPreview } from '@taskforceai/web/app/components/tool-usage/DiffPreview';
import { readDesktopCodeWorkspaceRoots } from '@taskforceai/web/app/lib/desktop/task-mode';
import { logger } from '@taskforceai/web/app/lib/logger';
import {
  getDesktopGitReviewDiff,
  getDesktopGitReviewStatus,
  type AppServerGitReviewDiffResult,
  type AppServerGitReviewStatusResult,
} from '../platform/app-server';

export const DESKTOP_CODE_WORKSPACE_PANE_WIDTH = 'min(68vw, 1180px)';

export type DesktopCodeWorkspaceView = 'empty' | 'review';

const countDiffLines = (rawDiff: string) => {
  let additions = 0;
  let deletions = 0;
  for (const line of rawDiff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
};

const emptyActionClass =
  'flex w-full items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.035] px-4 py-3 text-left text-sm text-slate-200 transition hover:bg-white/[0.07]';

export function DesktopCodeWorkspaceSurface(props: {
  open: boolean;
  view: DesktopCodeWorkspaceView;
  onOpenChange: (_open: boolean) => void;
  onViewChange: (_view: DesktopCodeWorkspaceView) => void;
  onOpenTerminal?: () => void;
  onOpenBrowser?: () => void;
  onOpenFiles?: () => void;
  onOpenSideTask?: () => void;
}) {
  const [status, setStatus] = useState<AppServerGitReviewStatusResult | null>(null);
  const [diff, setDiff] = useState<AppServerGitReviewDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspace = readDesktopCodeWorkspaceRoots()[0];

  const refresh = useCallback(async () => {
    if (!workspace) {
      setStatus(null);
      setDiff(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
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
    } catch (caught) {
      logger.warn('Failed to load desktop Code review surface', { error: caught });
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const parsedDiff = useMemo(() => (diff ? parseDiffPreview(diff.rawDiff) : null), [diff]);
  const stats = useMemo(() => countDiffLines(diff?.rawDiff ?? ''), [diff?.rawDiff]);
  const fileCount = parsedDiff?.files.length ?? status?.files.length ?? 0;
  const showPill = fileCount > 0;

  const openAction = (action: (() => void) | undefined) => {
    props.onOpenChange(false);
    action?.();
  };

  return (
    <>
      {showPill ? (
        <button
          type="button"
          className="fixed bottom-[8.35rem] left-1/2 z-[245] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-[#252525]/95 px-4 py-2 text-xs text-slate-300 shadow-xl backdrop-blur-md transition hover:bg-[#303030]"
          onClick={() => {
            props.onViewChange('review');
            props.onOpenChange(true);
          }}
          aria-label="Review workspace changes"
        >
          <GitCompareArrows aria-hidden="true" size={14} />
          <span>{fileCount} files changed</span>
          <span className="font-mono text-emerald-300">+{stats.additions}</span>
          <span className="font-mono text-rose-300">-{stats.deletions}</span>
        </button>
      ) : null}

      {props.open ? (
        <aside
          className="fixed top-0 right-0 bottom-0 z-[240] flex border-l border-white/10 bg-[#171717] text-slate-100 shadow-[-20px_0_60px_rgba(0,0,0,0.25)]"
          style={{ width: DESKTOP_CODE_WORKSPACE_PANE_WIDTH }}
          aria-label="Code workspace"
        >
          <button
            type="button"
            className="absolute top-3 right-3 z-10 rounded-md p-2 text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
            onClick={() => props.onOpenChange(false)}
            aria-label="Close Code workspace"
          >
            <PanelRightClose aria-hidden="true" size={18} />
          </button>
          {props.view === 'empty' || !status?.isGitRepository ? (
            <div className="flex min-w-0 flex-1 items-center justify-center p-10">
              <div className="w-full max-w-xl space-y-2">
                <button
                  type="button"
                  className={emptyActionClass}
                  onClick={() => props.onViewChange('review')}
                >
                  <SearchCode aria-hidden="true" size={18} />
                  <span>Review</span>
                  <span className="ml-auto text-xs text-slate-500">⌃⇧G</span>
                </button>
                <button
                  type="button"
                  className={emptyActionClass}
                  onClick={() => openAction(props.onOpenTerminal)}
                >
                  <SquareTerminal aria-hidden="true" size={18} />
                  Terminal
                </button>
                <button
                  type="button"
                  className={emptyActionClass}
                  onClick={() => openAction(props.onOpenBrowser)}
                >
                  <Globe2 aria-hidden="true" size={18} />
                  <span>Browser</span>
                  <span className="ml-auto text-xs text-slate-500">⌘T</span>
                </button>
                <button
                  type="button"
                  className={emptyActionClass}
                  onClick={() => openAction(props.onOpenFiles)}
                >
                  <Files aria-hidden="true" size={18} />
                  <span>Files</span>
                  <span className="ml-auto text-xs text-slate-500">⌘P</span>
                </button>
                <button
                  type="button"
                  className={emptyActionClass}
                  onClick={() => openAction(props.onOpenSideTask)}
                >
                  <LayoutPanelTop aria-hidden="true" size={18} />
                  <span>Side task</span>
                  <span className="ml-auto text-xs text-slate-500">⌥⌘S</span>
                </button>
                {!workspace ? (
                  <p className="pt-3 text-center text-xs text-slate-500">
                    Add a workspace with /code &lt;project-directory&gt; to enable Review and Files.
                  </p>
                ) : error ? (
                  <p className="pt-3 text-center text-xs text-rose-300">{error}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex min-h-16 items-center gap-3 border-b border-white/10 px-5">
                <span className="text-sm font-medium">Branch</span>
                <span className="text-sm text-slate-400">{status.branch ?? 'detached'}</span>
                <span className="font-mono text-sm text-emerald-300">+{stats.additions}</span>
                <span className="font-mono text-sm text-rose-300">-{stats.deletions}</span>
                <span className="ml-auto w-9" aria-hidden="true" />
              </header>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                {loading && !parsedDiff ? (
                  <p className="text-sm text-slate-500">Loading branch changes…</p>
                ) : parsedDiff ? (
                  <DiffPreview diff={parsedDiff} maxLinesPerFile={2_000} />
                ) : (
                  <p className="text-sm text-slate-500">No branch changes.</p>
                )}
                {diff?.truncated ? (
                  <p className="mt-3 text-xs text-amber-200">Diff limited to the first 512 KB.</p>
                ) : null}
                {error ? <p className="mt-3 text-xs text-rose-300">{error}</p> : null}
              </div>
            </div>
          )}
        </aside>
      ) : null}
    </>
  );
}
