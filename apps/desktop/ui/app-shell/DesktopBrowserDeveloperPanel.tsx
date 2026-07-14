'use client';

import { useEffect, useState } from 'react';

import {
  runDesktopBrowserDeveloperCommand,
  type DesktopBrowserDeveloperCommandResult,
} from '../platform/app-server';

interface DesktopBrowserDeveloperPanelProps {
  open: boolean;
}

export function DesktopBrowserDeveloperPanel({ open }: DesktopBrowserDeveloperPanelProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [captureBodies, setCaptureBodies] = useState(false);
  const [traceActive, setTraceActive] = useState(false);
  const [result, setResult] = useState<DesktopBrowserDeveloperCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (method: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await runDesktopBrowserDeveloperCommand({
        method,
        sessionId,
        ...(method === 'Browser.startSession'
          ? { captureBodies, maxBodyBytes: captureBodies ? 16 * 1024 : 0 }
          : {}),
      });
      setResult(next);
      setSessionId(next.active ? (next.sessionId ?? null) : null);
      if (method === 'Tracing.start') setTraceActive(true);
      if (method === 'Tracing.end' || method === 'Browser.endSession') setTraceActive(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open || !sessionId) return;
    setSessionId(null);
    setTraceActive(false);
  }, [open, sessionId]);

  useEffect(
    () => () => {
      if (!sessionId) return;
      void runDesktopBrowserDeveloperCommand({
        method: 'Browser.endSession',
        sessionId,
      }).catch(() => undefined);
    },
    [sessionId]
  );

  if (!open) return null;

  return (
    <section
      aria-label="Browser developer mode"
      className="relative z-10 max-h-72 shrink-0 overflow-auto border-b border-white/10 bg-[#0b0d12] px-4 py-3 text-xs text-slate-200"
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-auto text-slate-100">Developer Mode</strong>
        {!sessionId ? (
          <>
            <label className="flex items-center gap-1.5 text-slate-400">
              <input
                type="checkbox"
                checked={captureBodies}
                onChange={(event) => setCaptureBodies(event.target.checked)}
              />
              Capture same-origin bodies (16 KB)
            </label>
            <button
              type="button"
              className={developerButtonClass}
              disabled={busy}
              onClick={() => void run('Browser.startSession')}
            >
              Start session
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={developerButtonClass}
              onClick={() => void run('Network.getEntries')}
            >
              Network
            </button>
            <button
              type="button"
              className={developerButtonClass}
              onClick={() => void run('Performance.getMetrics')}
            >
              Metrics
            </button>
            <button
              type="button"
              className={developerButtonClass}
              onClick={() => void run(traceActive ? 'Tracing.end' : 'Tracing.start')}
            >
              {traceActive ? 'Stop trace' : 'Start trace'}
            </button>
            <button
              type="button"
              className={developerButtonClass}
              onClick={() => void run('Profiler.getProfile')}
            >
              Profile
            </button>
            <button
              type="button"
              className={developerButtonClass}
              onClick={() => void run('Browser.endSession')}
            >
              End
            </button>
          </>
        )}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Allowlisted CDP-compatible session: Network, Performance, Tracing, and Profiler only.
      </p>
      {error ? <p className="mt-2 text-rose-300">{error}</p> : null}
      {result ? (
        <pre className="mt-2 max-h-44 overflow-auto rounded-md border border-white/10 bg-black/30 p-2 text-[11px] leading-4 text-slate-300">
          {JSON.stringify(result.result, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}

const developerButtonClass =
  'rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10 disabled:opacity-40';
