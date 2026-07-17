'use client';

import { GitBranch } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  persistDesktopProjectWorkspace,
  readDesktopCodeWorkspaceRoots,
  readDesktopProjectWorkspace,
} from '@taskforceai/web/app/lib/desktop/task-mode';
import {
  enableDesktopLocalCoding,
  listDesktopWorktrees,
  type DesktopWorktree,
} from '../platform/app-server';

export function DesktopWorkspaceTargetSelector({ projectId }: { projectId: number | null }) {
  const [worktrees, setWorktrees] = useState<DesktopWorktree[]>([]);
  const [selected, setSelected] = useState(() => readDesktopProjectWorkspace(projectId) ?? '');

  useEffect(() => {
    setSelected(readDesktopProjectWorkspace(projectId) ?? '');
  }, [projectId]);

  useEffect(() => {
    const repository = readDesktopCodeWorkspaceRoots()[0];
    if (!repository) return;
    let active = true;
    void listDesktopWorktrees({ repository })
      .then((result) => {
        if (active) setWorktrees(result.worktrees);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (projectId === null || worktrees.length === 0) return null;

  const selectWorkspace = async (workspace: string) => {
    setSelected(workspace);
    persistDesktopProjectWorkspace(projectId, workspace);
    await enableDesktopLocalCoding({ workspace });
  };

  return (
    <label className="flex w-full items-center gap-2 px-2 pt-1 text-xs text-slate-400">
      <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">Task worktree</span>
      <select
        aria-label="Task worktree"
        className="min-w-0 flex-1 truncate border-0 bg-transparent py-1 text-xs text-slate-300 outline-none"
        value={selected || worktrees[0]?.path || ''}
        onChange={(event) => void selectWorkspace(event.currentTarget.value)}
      >
        {worktrees.map((worktree) => (
          <option key={worktree.path} value={worktree.path}>
            {worktree.branch ?? 'Detached HEAD'} — {worktree.path}
          </option>
        ))}
      </select>
    </label>
  );
}
