'use client';

import clsx from 'clsx';
import { BriefcaseBusiness, Check, ChevronDown, Code2, MessageCircle } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import type { DesktopTaskMode } from '../../lib/desktop/task-mode';
import {
  persistDesktopCodeWorkspace,
  persistDesktopCodeWorkspaceRoots,
  persistDesktopTaskMode,
  readDesktopCodeWorkspaceRoots,
} from '../../lib/desktop/task-mode';
import {
  disableDesktopLocalCoding,
  enableDesktopLocalCoding,
} from '../../lib/platform/desktop/app-server';

const modes = [
  {
    id: 'chat',
    label: 'Chat',
    description: 'Quick answers',
    icon: MessageCircle,
  },
  {
    id: 'work',
    label: 'Work',
    description: 'Long-running work',
    icon: BriefcaseBusiness,
  },
  { id: 'code', label: 'Code', description: 'Local workspace', icon: Code2 },
] as const;

export function DesktopTaskModeSwitcher(props: {
  mode: DesktopTaskMode;
  desktopRuntime: boolean;
  onModeChange: (_mode: DesktopTaskMode) => void;
}) {
  const { desktopRuntime, mode: activeMode, onModeChange } = props;
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspace, setWorkspace] = useState(() => readDesktopCodeWorkspaceRoots().join('\n'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeCodeWorkspaceRef = useRef<string | null>(null);
  const restoreGenerationRef = useRef(0);

  useEffect(() => {
    if (activeMode !== 'code') return;
    if (!desktopRuntime) {
      onModeChange('chat');
      persistDesktopTaskMode('chat');
      return;
    }
    const storedRoots = readDesktopCodeWorkspaceRoots();
    if (!storedRoots.length) {
      onModeChange('chat');
      persistDesktopTaskMode('chat');
      return;
    }
    const rootsKey = storedRoots.join('\n');
    if (activeCodeWorkspaceRef.current === rootsKey) return;
    const restoreGeneration = ++restoreGenerationRef.current;
    const params =
      storedRoots.length > 1
        ? { workspace: storedRoots[0], workspaceRoots: storedRoots }
        : { workspace: storedRoots[0] };
    void enableDesktopLocalCoding(params)
      .then((result) => {
        if (restoreGenerationRef.current !== restoreGeneration) return;
        activeCodeWorkspaceRef.current = (result.workspaceRoots ?? [result.workspace]).join('\n');
      })
      .catch(() => {
        if (restoreGenerationRef.current !== restoreGeneration) return;
        onModeChange('chat');
        persistDesktopTaskMode('chat');
      });
    return () => {
      if (restoreGenerationRef.current === restoreGeneration) {
        restoreGenerationRef.current += 1;
      }
    };
  }, [activeMode, desktopRuntime, onModeChange]);

  const selectMode = async (mode: DesktopTaskMode) => {
    if (mode === activeMode || busy) {
      setMenuOpen(false);
      return;
    }
    setError(null);
    if (mode === 'code') {
      const storedRoots = readDesktopCodeWorkspaceRoots();
      if (!storedRoots.length) {
        setWorkspaceDialogOpen(true);
        return;
      }
      setBusy(true);
      try {
        const params =
          storedRoots.length > 1
            ? { workspace: storedRoots[0], workspaceRoots: storedRoots }
            : { workspace: storedRoots[0] };
        const result = await enableDesktopLocalCoding(params);
        activeCodeWorkspaceRef.current = (result.workspaceRoots ?? [result.workspace]).join('\n');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to enable Code mode.');
        return;
      } finally {
        setBusy(false);
      }
    } else if (desktopRuntime) {
      restoreGenerationRef.current += 1;
      setBusy(true);
      try {
        await disableDesktopLocalCoding();
        activeCodeWorkspaceRef.current = null;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to leave Code mode.');
        return;
      } finally {
        setBusy(false);
      }
    }
    onModeChange(mode);
    persistDesktopTaskMode(mode);
    setMenuOpen(false);
  };

  const availableModes = modes.filter(({ id }) => desktopRuntime || id !== 'code');
  const selectedMode = availableModes.find(({ id }) => id === activeMode) ?? modes[0];

  const enableCodeWorkspace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selectedRoots = [
      ...new Set(
        workspace
          .split('\n')
          .map((root) => root.trim())
          .filter(Boolean)
      ),
    ];
    if (!selectedRoots.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await enableDesktopLocalCoding({
        workspace: selectedRoots[0],
        ...(selectedRoots.length > 1 ? { workspaceRoots: selectedRoots } : {}),
      });
      const enabledRoots = result.workspaceRoots ?? [result.workspace];
      activeCodeWorkspaceRef.current = enabledRoots.join('\n');
      persistDesktopCodeWorkspace(result.workspace);
      persistDesktopCodeWorkspaceRoots(enabledRoots);
      persistDesktopTaskMode('code');
      onModeChange('code');
      setWorkspace(enabledRoots.join('\n'));
      setWorkspaceDialogOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to enable Code mode.');
    } finally {
      setBusy(false);
    }
  };

  if (!desktopRuntime) {
    return (
      <div className="grid grid-cols-2 rounded-full border border-white/10 bg-black/30 p-1 shadow-xl backdrop-blur-xl">
        {availableModes.map(({ id, label, description }) => {
          const active = activeMode === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              aria-label={`${label} mode: ${description}`}
              className={clsx(
                'min-w-20 rounded-full px-5 py-2 text-sm font-medium transition',
                active
                  ? 'bg-white/[0.12] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-100'
              )}
              disabled={busy}
              onClick={() => void selectMode(id)}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className="relative">
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-label={`${selectedMode.label} mode selector`}
          className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-left transition hover:border-white/20 hover:bg-white/[0.09]"
          disabled={busy}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <selectedMode.icon aria-hidden="true" size={18} strokeWidth={2} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-100">{selectedMode.label}</span>
            <span className="block truncate text-xs text-slate-400">
              {selectedMode.description}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={clsx('shrink-0 transition-transform', menuOpen && 'rotate-180')}
            size={16}
          />
        </button>
        {menuOpen ? (
          <div className="absolute top-full right-0 left-0 z-20 mt-2 rounded-2xl border border-white/15 bg-[#111827] p-1.5 shadow-2xl">
            {availableModes.map(({ id, label, description, icon: Icon }) => {
              const active = activeMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${label} mode: ${description}`}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-slate-200 transition hover:bg-white/[0.08]"
                  disabled={busy}
                  onClick={() => void selectMode(id)}
                >
                  <Icon aria-hidden="true" size={18} strokeWidth={2} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-slate-400">{description}</span>
                  </span>
                  {active ? <Check aria-hidden="true" size={17} /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {error ? <p className="text-xs leading-5 text-red-300">{error}</p> : null}
      {workspaceDialogOpen ? (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <form
            className="w-full max-w-lg space-y-4 rounded-2xl border border-white/15 bg-[#0a1020] p-5 shadow-2xl"
            onSubmit={(event) => void enableCodeWorkspace(event)}
          >
            <div>
              <h2 className="text-lg font-semibold text-white">Choose Code workspace roots</h2>
              <p className="mt-1 text-sm text-slate-300">
                TaskForceAI will scope file tools and coding instructions to these repositories.
              </p>
            </div>
            <label className="grid gap-2 text-sm text-slate-200">
              Repository directories (one per line)
              <textarea
                autoFocus
                className="rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-white placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
                value={workspace}
                onChange={(event) => setWorkspace(event.currentTarget.value)}
                onInput={(event) => setWorkspace(event.currentTarget.value)}
                placeholder={'/Users/you/Developer/app\n/Users/you/Developer/shared-package'}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/10"
                onClick={() => setWorkspaceDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-400 disabled:opacity-50"
                disabled={!workspace.trim() || busy}
              >
                {busy ? 'Opening…' : 'Open in Code'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
