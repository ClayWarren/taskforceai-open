'use client';

import { type ReactNode, useCallback, useEffect, useState } from 'react';

import {
  createDesktopWorktree,
  enableDesktopLocalCoding,
  getDesktopLocalEnvironmentStatus,
  listDesktopWorktrees,
  runDesktopLocalEnvironmentAction,
  runDesktopLocalEnvironmentSetup,
  saveDesktopLocalEnvironment,
  type DesktopLocalEnvironmentStatus,
  type DesktopWorktreeListResult,
} from '../platform/desktop/app-server';

import {
  type LocalEnvironmentActionStatus,
  type WorktreeActionStatus,
} from './ProfileDesktopLocalSection.helpers';

type WorkspaceSectionMode = 'all' | 'environment' | 'worktrees';

const resolveWorkspaceMode = (
  props: { mode?: WorkspaceSectionMode } | undefined
): WorkspaceSectionMode => props?.mode ?? 'all';

const workspaceVisibility = (mode: WorkspaceSectionMode) => ({
  showWorktrees: mode === 'all' || mode === 'worktrees',
  showLocalEnvironment: mode === 'all' || mode === 'environment',
});

const OptionalWorkspaceSection = ({ show, children }: { show: boolean; children: ReactNode }) =>
  show ? children : null;

const WorkspaceFeedback = ({
  message,
  error,
}: {
  message: string | null;
  error: string | null;
}) => (
  <>
    {message ? <p className="text-xs text-emerald-100">{message}</p> : null}
    {error ? <p className="text-xs text-red-400">{error}</p> : null}
  </>
);

export function WorkspaceSections(props?: { mode?: WorkspaceSectionMode }) {
  const mode = resolveWorkspaceMode(props);
  const [localEnvironment, setLocalEnvironment] = useState<DesktopLocalEnvironmentStatus | null>(
    null
  );
  const [localEnvironmentSetupScript, setLocalEnvironmentSetupScript] = useState('');
  const [localEnvironmentActionName, setLocalEnvironmentActionName] = useState('Test');
  const [localEnvironmentActionScript, setLocalEnvironmentActionScript] = useState('');
  const [localEnvironmentActionStatus, setLocalEnvironmentActionStatus] =
    useState<LocalEnvironmentActionStatus>('idle');
  const [localEnvironmentMessage, setLocalEnvironmentMessage] = useState<string | null>(null);
  const [localEnvironmentError, setLocalEnvironmentError] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<DesktopWorktreeListResult | null>(null);
  const [worktreeBranch, setWorktreeBranch] = useState('codex/');
  const [worktreeBaseRef, setWorktreeBaseRef] = useState('');
  const [worktreePath, setWorktreePath] = useState('');
  const [worktreeActionStatus, setWorktreeActionStatus] = useState<WorktreeActionStatus>('idle');
  const [worktreeMessage, setWorktreeMessage] = useState<string | null>(null);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);

  const hydrateLocalEnvironmentStatus = useCallback((status: DesktopLocalEnvironmentStatus) => {
    setLocalEnvironment(status);
    setLocalEnvironmentSetupScript(status.config.setup?.default ?? '');
    const firstAction = status.config.actions?.[0];
    if (firstAction) {
      setLocalEnvironmentActionName(firstAction.name);
      setLocalEnvironmentActionScript(firstAction.scripts.default ?? '');
    }
  }, []);

  const refreshLocalEnvironment = useCallback(async () => {
    hydrateLocalEnvironmentStatus(await getDesktopLocalEnvironmentStatus());
  }, [hydrateLocalEnvironmentStatus]);

  const refreshWorktrees = useCallback(async () => {
    setWorktreeActionStatus('loading');
    setWorktreeError(null);
    try {
      setWorktrees(await listDesktopWorktrees());
      setWorktreeActionStatus('idle');
    } catch (caught) {
      setWorktreeError(caught instanceof Error ? caught.message : 'Worktrees are unavailable.');
      setWorktreeActionStatus('error');
    }
  }, []);

  const { showWorktrees, showLocalEnvironment } = workspaceVisibility(mode);

  useEffect(() => {
    if (showLocalEnvironment) {
      void refreshLocalEnvironment().catch(() => undefined);
    }
    if (showWorktrees) {
      void refreshWorktrees();
    }
  }, [refreshLocalEnvironment, refreshWorktrees, showLocalEnvironment, showWorktrees]);

  const saveLocalEnvironment = async () => {
    const actionName = localEnvironmentActionName.trim();
    const actionScript = localEnvironmentActionScript.trim();
    const actionId = actionName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setLocalEnvironmentActionStatus('saving');
    setLocalEnvironmentError(null);
    setLocalEnvironmentMessage(null);
    try {
      const next = await saveDesktopLocalEnvironment({
        config: {
          setup: { default: localEnvironmentSetupScript.trim() || null },
          actions:
            actionId && actionScript
              ? [
                  {
                    id: actionId,
                    name: actionName,
                    scripts: { default: actionScript },
                  },
                ]
              : [],
        },
      });
      setLocalEnvironment(next);
      setLocalEnvironmentActionStatus('ready');
      setLocalEnvironmentMessage('Saved local environment.');
    } catch (caught) {
      setLocalEnvironmentError(
        caught instanceof Error ? caught.message : 'Local environment save failed.'
      );
      setLocalEnvironmentActionStatus('error');
    }
  };

  const runLocalEnvironmentSetup = async () => {
    setLocalEnvironmentActionStatus('running');
    setLocalEnvironmentError(null);
    setLocalEnvironmentMessage(null);
    try {
      const result = await runDesktopLocalEnvironmentSetup();
      setLocalEnvironmentActionStatus('ready');
      setLocalEnvironmentMessage(`Setup exited ${result.exitCode ?? 0}.`);
    } catch (caught) {
      setLocalEnvironmentError(
        caught instanceof Error ? caught.message : 'Local environment setup failed.'
      );
      setLocalEnvironmentActionStatus('error');
    }
  };

  const runLocalEnvironmentAction = async () => {
    const action = localEnvironment?.config.actions?.[0];
    if (!action) {
      return;
    }
    setLocalEnvironmentActionStatus('running');
    setLocalEnvironmentError(null);
    setLocalEnvironmentMessage(null);
    try {
      const result = await runDesktopLocalEnvironmentAction({ actionId: action.id });
      setLocalEnvironmentActionStatus('ready');
      setLocalEnvironmentMessage(`${action.name} exited ${result.exitCode ?? 0}.`);
    } catch (caught) {
      setLocalEnvironmentError(
        caught instanceof Error ? caught.message : 'Local environment action failed.'
      );
      setLocalEnvironmentActionStatus('error');
    }
  };

  const enableWorktreeWorkspace = async (workspace: string) => {
    setWorktreeActionStatus('enabling');
    setWorktreeError(null);
    setWorktreeMessage(null);
    try {
      const result = await enableDesktopLocalCoding({ workspace });
      setWorktreeActionStatus('ready');
      setWorktreeMessage(`Local coding workspace set to ${result.workspace}.`);
      await refreshLocalEnvironment();
    } catch (caught) {
      setWorktreeError(caught instanceof Error ? caught.message : 'Worktree enable failed.');
      setWorktreeActionStatus('error');
    }
  };

  const createWorktree = async () => {
    setWorktreeActionStatus('creating');
    setWorktreeError(null);
    setWorktreeMessage(null);
    try {
      const result = await createDesktopWorktree({
        branch: worktreeBranch.trim() || null,
        baseRef: worktreeBaseRef.trim() || null,
        path: worktreePath.trim() || null,
      });
      setWorktrees(await listDesktopWorktrees({ repository: result.repositoryRoot }));
      setWorktreePath('');
      setWorktreeActionStatus('ready');
      setWorktreeMessage(result.message);
      await enableWorktreeWorkspace(result.worktree.path);
    } catch (caught) {
      setWorktreeError(caught instanceof Error ? caught.message : 'Worktree creation failed.');
      setWorktreeActionStatus('error');
    }
  };

  return (
    <>
      <OptionalWorkspaceSection show={showWorktrees}>
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <label className="text-sm font-medium">Worktrees</label>
              <p className="mt-1 truncate text-xs text-slate-200/80">
                {worktrees?.repositoryRoot ?? 'No Git worktrees loaded.'}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={worktreeActionStatus === 'loading'}
              onClick={() => void refreshWorktrees()}
            >
              {worktreeActionStatus === 'loading' ? 'Loading' : 'Refresh'}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,0.45fr)_minmax(0,0.25fr)_minmax(0,0.3fr)]">
            <label className="grid gap-1 text-xs text-slate-200/80">
              Branch
              <input
                className="rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-white placeholder:text-slate-300/65"
                value={worktreeBranch}
                onChange={(event) => setWorktreeBranch(event.currentTarget.value)}
                onInput={(event) => setWorktreeBranch(event.currentTarget.value)}
                placeholder="codex/feature"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-200/80">
              Base
              <input
                className="rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-white placeholder:text-slate-300/65"
                value={worktreeBaseRef}
                onChange={(event) => setWorktreeBaseRef(event.currentTarget.value)}
                onInput={(event) => setWorktreeBaseRef(event.currentTarget.value)}
                placeholder="HEAD"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-200/80">
              Path
              <input
                className="rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-white placeholder:text-slate-300/65"
                value={worktreePath}
                onChange={(event) => setWorktreePath(event.currentTarget.value)}
                onInput={(event) => setWorktreePath(event.currentTarget.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={worktreeActionStatus === 'creating'}
              onClick={() => void createWorktree()}
            >
              {worktreeActionStatus === 'creating' ? 'Creating' : 'Create worktree'}
            </button>
          </div>
          {worktrees?.worktrees.length ? (
            <ul className="space-y-2 text-xs text-slate-200/80">
              {worktrees.worktrees.slice(0, 5).map((worktree) => (
                <li
                  key={worktree.path}
                  className="flex items-center justify-between gap-3 border-t border-border pt-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-slate-100">{worktree.path}</p>
                    <p className="mt-1 truncate">
                      {worktree.branch ?? (worktree.detached ? 'Detached HEAD' : 'No branch')}
                      {worktree.prunable ? ' - prunable' : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={worktreeActionStatus === 'enabling'}
                    onClick={() => void enableWorktreeWorkspace(worktree.path)}
                  >
                    Use
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {worktrees && worktrees.worktrees.length > 5 ? (
            <p className="text-xs text-slate-200/80">
              {worktrees.worktrees.length - 5} more worktrees.
            </p>
          ) : null}
          <WorkspaceFeedback message={worktreeMessage} error={worktreeError} />
        </div>
      </OptionalWorkspaceSection>

      <OptionalWorkspaceSection show={showLocalEnvironment}>
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <label className="text-sm font-medium">Local environment</label>
              <p className="mt-1 truncate text-xs text-slate-200/80">
                {localEnvironment?.configPath ?? 'No local environment loaded.'}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={localEnvironmentActionStatus === 'saving'}
              onClick={() => void saveLocalEnvironment()}
            >
              {localEnvironmentActionStatus === 'saving' ? 'Saving' : 'Save'}
            </button>
          </div>
          <label className="grid gap-1 text-xs text-slate-200/80">
            Setup script
            <textarea
              className="min-h-20 w-full resize-y rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-white placeholder:text-slate-300/65"
              value={localEnvironmentSetupScript}
              onChange={(event) => setLocalEnvironmentSetupScript(event.currentTarget.value)}
              onInput={(event) => setLocalEnvironmentSetupScript(event.currentTarget.value)}
              placeholder="bun install"
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,0.4fr)_minmax(0,1fr)]">
            <label className="grid gap-1 text-xs text-slate-200/80">
              Action
              <input
                className="rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-white placeholder:text-slate-300/65"
                value={localEnvironmentActionName}
                onChange={(event) => setLocalEnvironmentActionName(event.currentTarget.value)}
                onInput={(event) => setLocalEnvironmentActionName(event.currentTarget.value)}
                placeholder="Test"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-200/80">
              Script
              <input
                className="rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-white placeholder:text-slate-300/65"
                value={localEnvironmentActionScript}
                onChange={(event) => setLocalEnvironmentActionScript(event.currentTarget.value)}
                onInput={(event) => setLocalEnvironmentActionScript(event.currentTarget.value)}
                placeholder="bun test"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                !localEnvironment?.config.setup?.default ||
                localEnvironmentActionStatus === 'running'
              }
              onClick={() => void runLocalEnvironmentSetup()}
            >
              Run setup
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                !localEnvironment?.config.actions?.[0] || localEnvironmentActionStatus === 'running'
              }
              onClick={() => void runLocalEnvironmentAction()}
            >
              Run action
            </button>
          </div>
          <WorkspaceFeedback message={localEnvironmentMessage} error={localEnvironmentError} />
        </div>
      </OptionalWorkspaceSection>
    </>
  );
}
