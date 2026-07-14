'use client';

import clsx from 'clsx';
import { BriefcaseBusiness, Check, ChevronDown, Code2, MessageCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { DesktopTaskMode } from '../../lib/desktop/task-mode';
import { persistDesktopTaskMode, readDesktopCodeWorkspaceRoots } from '../../lib/desktop/task-mode';
import {
  disableDesktopLocalCoding,
  enableDesktopLocalCoding,
} from '../../lib/platform/desktop-api';

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
    description: 'Create, learn, and explore',
    icon: BriefcaseBusiness,
  },
  { id: 'code', label: 'Code', description: 'Build, debug, and ship', icon: Code2 },
] as const;

export function DesktopTaskModeSwitcher(props: {
  mode: DesktopTaskMode;
  desktopRuntime: boolean;
  onModeChange: (_mode: DesktopTaskMode) => void;
  variant?: 'default' | 'sidebar-header';
}) {
  const { desktopRuntime, mode: activeMode, onModeChange, variant = 'default' } = props;
  const sidebarHeader = variant === 'sidebar-header';
  const [menuOpen, setMenuOpen] = useState(false);
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
      if (storedRoots.length) {
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
      <div className={clsx('relative', sidebarHeader && 'shrink-0')}>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-label={`${selectedMode.label} mode selector`}
          className={clsx(
            'flex items-center text-left transition',
            sidebarHeader
              ? 'gap-2 rounded-2xl bg-white/[0.08] px-3.5 py-2 text-slate-100 hover:bg-white/[0.12]'
              : 'w-full gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2.5 hover:border-white/20 hover:bg-white/[0.09]'
          )}
          disabled={busy}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {sidebarHeader ? (
            <span className="text-lg font-semibold tracking-[-0.01em]">{selectedMode.label}</span>
          ) : (
            <>
              <selectedMode.icon aria-hidden="true" size={18} strokeWidth={2} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-100">
                  {selectedMode.label}
                </span>
                <span className="block truncate text-xs text-slate-400">
                  {selectedMode.description}
                </span>
              </span>
            </>
          )}
          <ChevronDown
            aria-hidden="true"
            className={clsx(
              'shrink-0 text-slate-400 transition-transform',
              menuOpen && 'rotate-180'
            )}
            size={sidebarHeader ? 18 : 16}
          />
        </button>
        {menuOpen ? (
          <div
            className={clsx(
              'absolute top-full left-0 z-30 mt-2 border border-white/15 p-1.5 shadow-2xl',
              sidebarHeader ? 'w-64 rounded-2xl bg-[#292929]' : 'right-0 rounded-2xl bg-[#111827]'
            )}
          >
            {availableModes.map(({ id, label, description, icon: Icon }) => {
              const active = activeMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${label} mode: ${description}`}
                  className={clsx(
                    'flex w-full items-center text-left text-slate-200 transition hover:bg-white/[0.08] focus-visible:bg-white/[0.08] focus-visible:outline-none',
                    sidebarHeader ? 'gap-3 rounded-xl px-4 py-3' : 'gap-3 rounded-xl px-3 py-2.5'
                  )}
                  disabled={busy}
                  onClick={() => void selectMode(id)}
                >
                  {!sidebarHeader ? <Icon aria-hidden="true" size={18} strokeWidth={2} /> : null}
                  <span className="min-w-0 flex-1">
                    <span
                      className={clsx('block font-medium', sidebarHeader ? 'text-base' : 'text-sm')}
                    >
                      {label}
                    </span>
                    <span
                      className={clsx(
                        'block text-slate-400',
                        sidebarHeader ? 'mt-0.5 text-sm' : 'text-xs'
                      )}
                    >
                      {description}
                    </span>
                  </span>
                  {active ? <Check aria-hidden="true" size={sidebarHeader ? 20 : 17} /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {error ? <p className="text-xs leading-5 text-red-300">{error}</p> : null}
    </>
  );
}
