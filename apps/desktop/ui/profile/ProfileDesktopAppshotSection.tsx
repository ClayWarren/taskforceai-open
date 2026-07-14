'use client';

import { useState } from 'react';

import {
  addDesktopAppServerAttachment,
  captureDesktopAppshotFrontmost,
  type DesktopAppshotCaptureResult,
} from '../platform/app-server';

import { type AppshotActionStatus } from './ProfileDesktopLocalSection.helpers';

export function AppshotSection() {
  const [appshot, setAppshot] = useState<DesktopAppshotCaptureResult | null>(null);
  const [appshotActionStatus, setAppshotActionStatus] = useState<AppshotActionStatus>('idle');
  const [appshotError, setAppshotError] = useState<string | null>(null);
  const [appshotMessage, setAppshotMessage] = useState<string | null>(null);

  const captureAppshot = async () => {
    setAppshotActionStatus('capturing');
    setAppshotError(null);
    setAppshotMessage(null);
    try {
      const next = await captureDesktopAppshotFrontmost();
      setAppshot(next);
      setAppshotActionStatus(next.supported ? 'ready' : 'error');
      if (!next.supported) {
        setAppshotError(next.message);
      }
    } catch (caught) {
      setAppshotError(caught instanceof Error ? caught.message : 'Appshot capture failed.');
      setAppshotActionStatus('error');
    }
  };

  const attachAppshotArtifact = async (path?: string | null) => {
    if (!path) {
      return;
    }
    setAppshotActionStatus('attaching');
    setAppshotError(null);
    setAppshotMessage(null);
    try {
      const result = await addDesktopAppServerAttachment({ path });
      setAppshotMessage(`Attached ${result.attachment.name}.`);
      setAppshotActionStatus('ready');
    } catch (caught) {
      setAppshotError(caught instanceof Error ? caught.message : 'Appshot attachment failed.');
      setAppshotActionStatus('error');
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label className="text-sm font-medium">Appshots</label>
          <p className="mt-1 text-xs text-slate-200/80">
            {appshot?.message ?? 'No appshot captured.'}
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={appshotActionStatus === 'capturing' || appshotActionStatus === 'attaching'}
          onClick={() => void captureAppshot()}
        >
          {appshotActionStatus === 'capturing' ? 'Capturing' : 'Take appshot'}
        </button>
      </div>
      {appshot ? (
        <>
          <div className="grid gap-2 text-xs text-slate-200/80 sm:grid-cols-2">
            <p className="truncate">App: {appshot.appName ?? 'Unknown'}</p>
            <p className="truncate">Window: {appshot.windowTitle ?? 'Untitled'}</p>
            <p className="truncate">Image: {appshot.imagePath ?? 'Unavailable'}</p>
            <p className="truncate">Text: {appshot.textPath ?? 'Unavailable'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!appshot.imagePath || appshotActionStatus === 'attaching'}
              onClick={() => void attachAppshotArtifact(appshot.imagePath)}
            >
              Attach image
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!appshot.textPath || appshotActionStatus === 'attaching'}
              onClick={() => void attachAppshotArtifact(appshot.textPath)}
            >
              Attach text
            </button>
          </div>
          {appshot.text ? (
            <textarea
              readOnly
              aria-label="Appshot text"
              className="max-h-32 min-h-20 w-full resize-y rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-slate-200/80"
              value={appshot.text}
              onFocus={(event) => event.currentTarget.select()}
            />
          ) : null}
        </>
      ) : null}
      {appshotMessage ? <p className="text-xs text-emerald-100">{appshotMessage}</p> : null}
      {appshotError ? <p className="text-xs text-red-400">{appshotError}</p> : null}
    </div>
  );
}
