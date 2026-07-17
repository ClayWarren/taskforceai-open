'use client';

import { Plus, Settings2, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import type { TerminalLaunchConfig } from '../platform/app-server-types';
import { getDesktopTerminalLaunchConfig } from '../platform/app-server';

const DesktopTerminalSession = lazy(() =>
  import('./DesktopTerminalSession').then((module) => ({ default: module.DesktopTerminalSession }))
);

const PREFERENCE_KEY = 'taskforceai.desktop.terminal.v1';
const DEFAULT_SCOPE_KEY = 'task:draft';

type TerminalPreference = { preferWsl: boolean; wslDistribution?: string };
type TerminalTab = {
  config: TerminalLaunchConfig;
  exited: boolean;
  id: number;
  scopeKey: string;
  title: string;
};

const readPreference = (): TerminalPreference => {
  try {
    const stored = JSON.parse(
      localStorage.getItem(PREFERENCE_KEY) ?? '{}'
    ) as Partial<TerminalPreference>;
    return {
      preferWsl: stored.preferWsl === true,
      ...(stored.wslDistribution ? { wslDistribution: stored.wslDistribution } : {}),
    };
  } catch {
    return { preferWsl: false };
  }
};

const titleForTab = (config: TerminalLaunchConfig, tabNumber: number) => {
  const baseTitle = config.backend === 'wsl' ? (config.wslDistribution ?? 'WSL') : 'Shell';
  return tabNumber === 1 ? baseTitle : `${baseTitle} ${tabNumber}`;
};

const basename = (path: string) =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .at(-1) || path;

export function DesktopTerminalPanel({
  onClose,
  open,
  scopeKey = DEFAULT_SCOPE_KEY,
  scopeLabel,
}: {
  onClose: () => void;
  open: boolean;
  scopeKey?: string;
  scopeLabel?: string;
}) {
  const effectiveScopeKey = scopeKey.trim() || DEFAULT_SCOPE_KEY;
  const [preference, setPreference] = useState<TerminalPreference>({ preferWsl: false });
  const [availableConfig, setAvailableConfig] = useState<TerminalLaunchConfig | null>(null);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeIds, setActiveIds] = useState<Record<string, number | null>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tabsRef = useRef(tabs);
  const activeIdsRef = useRef(activeIds);
  const previousScopeRef = useRef(effectiveScopeKey);
  const pendingScopeRef = useRef(new Set<string>());
  tabsRef.current = tabs;
  activeIdsRef.current = activeIds;
  const scopedTabs = tabs.filter((tab) => tab.scopeKey === effectiveScopeKey);
  const activeId = activeIds[effectiveScopeKey] ?? scopedTabs.at(-1)?.id ?? null;
  const activeTab = scopedTabs.find((tab) => tab.id === activeId);

  const loadConfig = useCallback(async (nextPreference: TerminalPreference) => {
    const config = await getDesktopTerminalLaunchConfig(nextPreference);
    setAvailableConfig(config);
    return config;
  }, []);

  const addTab = useCallback(
    async (nextPreference: TerminalPreference, targetScopeKey: string) => {
      setError(null);
      try {
        const config = await loadConfig(nextPreference);
        const id = Date.now() + Math.floor(Math.random() * 1000);
        setTabs((current) => {
          const tabNumber = current.filter((tab) => tab.scopeKey === targetScopeKey).length + 1;
          return [
            ...current,
            {
              config,
              exited: false,
              id,
              scopeKey: targetScopeKey,
              title: titleForTab(config, tabNumber),
            },
          ];
        });
        setActiveIds((current) => ({ ...current, [targetScopeKey]: id }));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    },
    [loadConfig]
  );

  const updatePreference = (next: TerminalPreference) => {
    setPreference(next);
    localStorage.setItem(PREFERENCE_KEY, JSON.stringify(next));
    void loadConfig(next).catch((loadError) => setError(String(loadError)));
  };

  useEffect(() => {
    const previousScope = previousScopeRef.current;
    let currentTabs = tabsRef.current;

    if (previousScope === DEFAULT_SCOPE_KEY && effectiveScopeKey !== previousScope) {
      currentTabs = currentTabs.map((tab) =>
        tab.scopeKey === previousScope ? { ...tab, scopeKey: effectiveScopeKey } : tab
      );
      const previousActiveId = activeIdsRef.current[previousScope];
      tabsRef.current = currentTabs;
      setTabs(currentTabs);
      setActiveIds((current) => ({
        ...current,
        [effectiveScopeKey]: previousActiveId ?? null,
        [previousScope]: null,
      }));
    }
    previousScopeRef.current = effectiveScopeKey;
    if (!open) return;

    const stored = readPreference();
    setPreference(stored);

    if (!currentTabs.some((tab) => tab.scopeKey === effectiveScopeKey)) {
      if (!pendingScopeRef.current.has(effectiveScopeKey)) {
        pendingScopeRef.current.add(effectiveScopeKey);
        void addTab(stored, effectiveScopeKey).finally(() =>
          pendingScopeRef.current.delete(effectiveScopeKey)
        );
      }
    } else {
      void loadConfig(stored).catch((loadError) => setError(String(loadError)));
    }
    // Existing PTYs deliberately remain alive while the panel is hidden or another task is active.
  }, [addTab, effectiveScopeKey, loadConfig, open]);

  const closeTab = (id: number) => {
    const remaining = tabsRef.current.filter((tab) => tab.id !== id);
    setTabs(remaining);
    if (activeId === id) {
      const nextActiveId = remaining.findLast((tab) => tab.scopeKey === effectiveScopeKey)?.id;
      setActiveIds((current) => ({
        ...current,
        [effectiveScopeKey]: nextActiveId ?? null,
      }));
    }
  };

  return (
    <section
      className={`${open ? 'flex' : 'hidden'} fixed right-6 bottom-6 z-[270] h-[min(520px,58vh)] w-[min(900px,calc(100vw-8rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/96 text-slate-100 shadow-[0_24px_70px_rgba(2,6,23,0.62)] backdrop-blur-xl`}
      aria-label="Desktop terminal"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span
          className="max-w-32 shrink-0 truncate text-[11px] font-medium text-slate-500"
          title={activeTab?.config.workspaceRoot}
        >
          {scopeLabel ? `${scopeLabel} · ` : ''}
          {activeTab ? basename(activeTab.config.workspaceRoot) : 'Code task'}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {scopedTabs.map((tab) => (
            <div
              key={tab.id}
              className={`group flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${tab.id === activeId ? 'bg-blue-500/20 text-blue-100' : 'text-slate-400 hover:bg-white/5'}`}
            >
              <button
                type="button"
                title={tab.config.workspaceRoot}
                aria-pressed={tab.id === activeId}
                onClick={() =>
                  setActiveIds((current) => ({ ...current, [effectiveScopeKey]: tab.id }))
                }
              >
                {tab.title}
                {tab.exited ? ' (exited)' : ''}
              </button>
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                className="rounded text-slate-500 hover:text-white"
                onClick={() => closeTab(tab.id)}
              >
                <X aria-hidden="true" size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            aria-label="New terminal"
            onClick={() => void addTab(preference, effectiveScopeKey)}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <Plus size={15} />
          </button>
        </div>
        <button
          type="button"
          aria-label="Terminal settings"
          onClick={() => setShowSettings((value) => !value)}
          className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
        >
          <Settings2 size={15} />
        </button>
        <button
          type="button"
          aria-label="Close terminal"
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      {showSettings ? (
        <div className="flex items-center gap-4 border-b border-white/10 bg-slate-900/80 px-4 py-2 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={preference.preferWsl}
              disabled={!availableConfig?.wslAvailable}
              onChange={(event) =>
                updatePreference({ ...preference, preferWsl: event.target.checked })
              }
            />
            Use WSL for new terminals
          </label>
          {availableConfig?.wslAvailable ? (
            <select
              value={preference.wslDistribution ?? availableConfig.wslDistribution ?? ''}
              onChange={(event) =>
                updatePreference({ ...preference, wslDistribution: event.target.value })
              }
              className="rounded border border-white/10 bg-slate-950 px-2 py-1"
            >
              {availableConfig.wslDistributions.map((distribution) => (
                <option key={distribution}>{distribution}</option>
              ))}
            </select>
          ) : (
            <span className="text-slate-500">WSL is not available on this system.</span>
          )}
          <span className="ml-auto text-slate-500">Changes apply to new tabs.</span>
        </div>
      ) : null}

      {error ? (
        <div className="border-b border-rose-500/20 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1 bg-slate-950">
        {tabs.map((tab) => {
          const isActive = tab.scopeKey === effectiveScopeKey && tab.id === activeId;
          return (
            <div key={tab.id} className={isActive ? 'absolute inset-0' : 'hidden'}>
              <Suspense
                fallback={<div className="p-4 text-xs text-slate-500">Loading terminal…</div>}
              >
                <DesktopTerminalSession
                  active={isActive && open}
                  config={tab.config}
                  onExited={() =>
                    setTabs((current) =>
                      current.map((candidate) =>
                        candidate.id === tab.id ? { ...candidate, exited: true } : candidate
                      )
                    )
                  }
                />
              </Suspense>
            </div>
          );
        })}
        {!activeTab ? (
          <div className="p-6 text-center text-sm text-slate-500">Open a new terminal tab.</div>
        ) : null}
      </div>
    </section>
  );
}
