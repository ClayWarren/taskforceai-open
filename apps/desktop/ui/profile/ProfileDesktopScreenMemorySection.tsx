'use client';

import { useState } from 'react';

import { Switch } from '@taskforceai/ui-kit/switch';

import {
  captureDesktopScreenMemoryNow,
  setDesktopScreenMemoryEnabled,
  setDesktopScreenMemoryPaused,
  type DesktopScreenMemoryStatus,
} from '../platform/app-server';

import {
  formatScreenMemoryTime,
  type ScreenMemoryActionStatus,
} from './ProfileDesktopLocalSection.helpers';

export function ScreenMemorySection({
  screenMemory,
  onScreenMemoryChange,
}: {
  screenMemory: DesktopScreenMemoryStatus;
  onScreenMemoryChange: (next: DesktopScreenMemoryStatus) => void;
}) {
  const [screenMemoryActionStatus, setScreenMemoryActionStatus] =
    useState<ScreenMemoryActionStatus>('idle');
  const [screenMemoryError, setScreenMemoryError] = useState<string | null>(null);

  const updateScreenMemoryEnabled = async (enabled: boolean) => {
    setScreenMemoryActionStatus('saving');
    setScreenMemoryError(null);
    try {
      const next = await setDesktopScreenMemoryEnabled(enabled);
      onScreenMemoryChange(next);
      setScreenMemoryActionStatus('idle');
    } catch (caught) {
      setScreenMemoryError(
        caught instanceof Error ? caught.message : 'Screen Memory update failed.'
      );
      setScreenMemoryActionStatus('error');
    }
  };

  const updateScreenMemoryPaused = async (paused: boolean) => {
    setScreenMemoryActionStatus('saving');
    setScreenMemoryError(null);
    try {
      const next = await setDesktopScreenMemoryPaused(paused);
      onScreenMemoryChange(next);
      setScreenMemoryActionStatus('idle');
    } catch (caught) {
      setScreenMemoryError(
        caught instanceof Error ? caught.message : 'Screen Memory update failed.'
      );
      setScreenMemoryActionStatus('error');
    }
  };

  const captureScreenMemory = async () => {
    setScreenMemoryActionStatus('capturing');
    setScreenMemoryError(null);
    try {
      const next = await captureDesktopScreenMemoryNow();
      onScreenMemoryChange(next);
      setScreenMemoryActionStatus('idle');
    } catch (caught) {
      setScreenMemoryError(
        caught instanceof Error ? caught.message : 'Screen Memory capture failed.'
      );
      setScreenMemoryActionStatus('error');
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label className="text-sm font-medium">Screen Memory</label>
          <p className="mt-1 text-xs text-slate-200/80">{screenMemory.message}</p>
        </div>
        <Switch
          checked={screenMemory.enabled}
          disabled={!screenMemory.supported || screenMemoryActionStatus === 'saving'}
          onCheckedChange={(enabled) => void updateScreenMemoryEnabled(enabled)}
          aria-label="Toggle Screen Memory"
        />
      </div>
      <div className="grid gap-2 text-xs text-slate-200/80 sm:grid-cols-2">
        <p className="truncate">Latest: {formatScreenMemoryTime(screenMemory.latestCaptureAt)}</p>
        <p className="truncate">Snapshots: {screenMemory.captureCount}</p>
        <p className="truncate">Capture directory: {screenMemory.captureDirectory}</p>
        <p className="truncate">Memory source: {screenMemory.memoryPath ?? 'Unavailable'}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={
            !screenMemory.supported ||
            !screenMemory.enabled ||
            screenMemoryActionStatus === 'saving'
          }
          onClick={() => void updateScreenMemoryPaused(!screenMemory.paused)}
        >
          {screenMemory.paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={
            !screenMemory.supported ||
            !screenMemory.enabled ||
            screenMemory.paused ||
            screenMemoryActionStatus === 'capturing'
          }
          onClick={() => void captureScreenMemory()}
        >
          {screenMemoryActionStatus === 'capturing' ? 'Capturing' : 'Capture now'}
        </button>
      </div>
      {screenMemoryError ? <p className="text-xs text-red-400">{screenMemoryError}</p> : null}
    </div>
  );
}
