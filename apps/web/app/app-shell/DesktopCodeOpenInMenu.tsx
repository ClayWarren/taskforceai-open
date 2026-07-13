'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@taskforceai/ui-kit/dropdown-menu';
import { ChevronDown, Code2, Folder, Hammer, PackageOpen, SquareTerminal } from 'lucide-react';
import { useState } from 'react';

import { readDesktopCodeWorkspaceRoots } from '../lib/desktop/task-mode';
import { logger } from '../lib/logger';
import {
  openDesktopWorkspaceIn,
  type DesktopWorkspaceOpenTarget,
} from '../lib/platform/desktop/app-server';

const targets: Array<{
  id: DesktopWorkspaceOpenTarget;
  label: string;
  icon: typeof Code2;
}> = [
  { id: 'vscode', label: 'VS Code', icon: Code2 },
  { id: 'cursor', label: 'Cursor', icon: PackageOpen },
  { id: 'finder', label: 'Finder', icon: Folder },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'xcode', label: 'Xcode', icon: Hammer },
];

export function DesktopCodeOpenInMenu() {
  const roots = readDesktopCodeWorkspaceRoots();
  const [root, setRoot] = useState(roots[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  const activeRoot = roots.includes(root) ? root : (roots[0] ?? '');

  const openIn = async (target: DesktopWorkspaceOpenTarget) => {
    if (!activeRoot) return;
    setError(null);
    try {
      await openDesktopWorkspaceIn({ root: activeRoot, target });
    } catch (caught) {
      logger.warn('Failed to open Code workspace in application', { error: caught, target });
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-[#242424] px-3 text-sm text-slate-200 shadow-lg transition hover:bg-[#2d2d2d] disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="Open workspace in"
            disabled={!activeRoot}
            title={activeRoot || 'Choose a Code workspace before opening it in another app'}
          >
            <PackageOpen aria-hidden="true" size={17} />
            <span>Open in</span>
            <ChevronDown aria-hidden="true" size={15} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-56 border border-white/10 bg-[#2a2a2a] p-1.5 text-slate-100 shadow-2xl"
        >
          {roots.length > 1 ? (
            <>
              <DropdownMenuLabel className="px-2 py-1 text-xs font-normal text-slate-400">
                Workspace
              </DropdownMenuLabel>
              {roots.map((workspaceRoot) => (
                <DropdownMenuItem
                  key={workspaceRoot}
                  className="rounded-md text-sm focus:bg-white/10 focus:text-white"
                  onSelect={() => setRoot(workspaceRoot)}
                >
                  <Folder aria-hidden="true" size={16} />
                  <span className="max-w-52 truncate">{workspaceRoot.split('/').pop()}</span>
                  {workspaceRoot === activeRoot ? <span className="ml-auto">✓</span> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-white/10" />
            </>
          ) : null}
          {targets.map(({ id, label, icon: Icon }) => (
            <DropdownMenuItem
              key={id}
              className="rounded-md text-sm focus:bg-white/10 focus:text-white"
              onSelect={() => void openIn(id)}
            >
              <Icon aria-hidden="true" size={17} />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p className="absolute top-full right-0 mt-2 w-72 rounded-lg border border-red-400/20 bg-red-950/95 px-3 py-2 text-xs text-red-100 shadow-xl">
          {error}
        </p>
      ) : null}
    </div>
  );
}
