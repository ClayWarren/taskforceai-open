'use client';

import { useCallback, useEffect, useState } from 'react';

import { logger } from '@taskforceai/web/app/lib/logger';
import type { DesktopTaskMode } from '@taskforceai/web/app/lib/desktop/task-mode';
import {
  createDesktopAppServerAgentSession,
  getDesktopAppServerEnvironmentStatus,
  handoffDesktopAppServerThread,
  inspectDesktopAppServerDiagnostics,
  listDesktopAppServerAgentSessions,
  listDesktopAppServerChannels,
  listDesktopAppServerSchedules,
  pauseDesktopAppServerAgentSession,
  resumeDesktopAppServerAgentSession,
  cancelDesktopAppServerAgentSession,
  forkDesktopAppServerAgentSession,
  runDesktopAppServerAgentSession,
  tickDesktopAppServerSchedules,
  type AppServerAgentSession,
  type AppServerEnvironmentStatus,
  type AppServerChannel,
  type AppServerDiagnosticSection,
  type AppServerSchedule,
} from '../platform/app-server';
import { DesktopAgentSummaryBlock } from './DesktopAgentSummaryBlock';
import { DesktopGitReviewPanel } from './DesktopGitReviewPanel';
import { controlButtonClass, primaryControlButtonClass } from './desktop-panel-styles';
import { useDesktopGitReview } from './useDesktopGitReview';

interface DesktopAgentManagerPanelProps {
  open: boolean;
  onClose: () => void;
  taskMode?: DesktopTaskMode;
}

export function DesktopAgentManagerPanel({
  open,
  onClose,
  taskMode = 'code',
}: DesktopAgentManagerPanelProps) {
  const [sessions, setSessions] = useState<AppServerAgentSession[]>([]);
  const [environment, setEnvironment] = useState<AppServerEnvironmentStatus | null>(null);
  const [channels, setChannels] = useState<AppServerChannel[]>([]);
  const [schedules, setSchedules] = useState<AppServerSchedule[]>([]);
  const [diagnostics, setDiagnostics] = useState<AppServerDiagnosticSection[]>([]);
  const [objective, setObjective] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);
  const gitReview = useDesktopGitReview({
    enabled: taskMode === 'code',
    open,
    sessions,
  });

  const refresh = useCallback(async () => {
    const [agentList, channelList, scheduleList, inspection, environmentStatus] = await Promise.all(
      [
        listDesktopAppServerAgentSessions(),
        listDesktopAppServerChannels(),
        listDesktopAppServerSchedules(),
        inspectDesktopAppServerDiagnostics(),
        getDesktopAppServerEnvironmentStatus(),
      ]
    );
    setSessions(agentList.sessions);
    setChannels(channelList.channels);
    setSchedules(scheduleList.schedules);
    setDiagnostics(inspection.sections);
    setEnvironment(environmentStatus);
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void refresh().catch((error) => {
      logger.warn('Failed to refresh desktop agent manager state', { error });
      if (active) setMessage(error instanceof Error ? error.message : String(error));
    });
    const interval = window.setInterval(() => {
      void refresh().catch((error) => {
        logger.warn('Failed to refresh desktop agent manager state', { error });
        if (active) setMessage(error instanceof Error ? error.message : String(error));
      });
    }, 5_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [open, refresh]);

  if (!open) return null;

  const runAndRefresh = async (operation: () => Promise<unknown>) => {
    try {
      setMessage(null);
      await operation();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handoffAndRefresh = async (threadId: string) => {
    if (!environment?.remoteConnected) return;
    const source = environment.active === 'remote' ? 'remote' : 'local';
    const target = source === 'local' ? 'remote' : 'local';
    try {
      setMessage(null);
      setHandoffMessage(null);
      const result = await handoffDesktopAppServerThread({
        threadId,
        source,
        target,
      });
      setHandoffMessage(
        result.warning ??
          `${result.thread.title} moved to ${target} with ${result.thread.taskMode} mode preserved.`
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
      <section
        className="max-h-[86vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950 text-slate-100 shadow-2xl"
        aria-label="Agent manager"
      >
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Agent Manager</h2>
            <p className="mt-1 text-xs text-slate-400">
              Local app-server sessions, channels, schedules, and diagnostics.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="grid max-h-[calc(86vh-76px)] gap-4 overflow-y-auto p-5 lg:grid-cols-[1.35fr_0.9fr]">
          <div className="space-y-4">
            {taskMode === 'code' ? <DesktopGitReviewPanel review={gitReview} /> : null}

            <form
              className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const trimmed = objective.trim();
                if (!trimmed) return;
                void runAndRefresh(async () => {
                  await createDesktopAppServerAgentSession({
                    objective: trimmed,
                    source: 'desktop',
                    taskMode: 'work',
                  });
                  setObjective('');
                });
              }}
            >
              <label className="text-sm font-medium text-slate-200" htmlFor="agent-objective">
                New background session
              </label>
              <textarea
                id="agent-objective"
                className="mt-3 min-h-24 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
              />
              <button
                type="submit"
                className="mt-3 rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
              >
                Start session
              </button>
            </form>

            <div className="space-y-3">
              {sessions.length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                  No local agent sessions yet.
                </p>
              ) : (
                sessions.map((session) => {
                  const runIds = session.runIds ?? [];
                  return (
                    <article
                      key={session.sessionId}
                      className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">{session.title}</h3>
                          <p className="mt-1 text-[11px] font-medium tracking-wide text-sky-300 uppercase">
                            {session.taskMode ?? 'chat'} mode
                          </p>
                          <p className="mt-1 text-sm text-slate-300">{session.objective}</p>
                          {session.lastMessage ? (
                            <p className="mt-2 text-xs text-slate-400">{session.lastMessage}</p>
                          ) : null}
                          <p className="mt-2 text-xs text-slate-500">
                            {session.activeRunId
                              ? `active run ${session.activeRunId}`
                              : `${runIds.length} run${runIds.length === 1 ? '' : 's'}`}
                          </p>
                          {session.lastError ? (
                            <p className="mt-2 text-xs text-red-200">{session.lastError}</p>
                          ) : null}
                        </div>
                        <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300">
                          {session.state}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={primaryControlButtonClass}
                          onClick={() =>
                            void runAndRefresh(() =>
                              runDesktopAppServerAgentSession({
                                sessionId: session.sessionId,
                              })
                            )
                          }
                        >
                          Run
                        </button>
                        <button
                          type="button"
                          className={controlButtonClass}
                          onClick={() =>
                            void runAndRefresh(() =>
                              pauseDesktopAppServerAgentSession(session.sessionId)
                            )
                          }
                        >
                          Pause
                        </button>
                        <button
                          type="button"
                          className={controlButtonClass}
                          onClick={() =>
                            void runAndRefresh(() =>
                              resumeDesktopAppServerAgentSession(session.sessionId)
                            )
                          }
                        >
                          Resume
                        </button>
                        <button
                          type="button"
                          className={controlButtonClass}
                          onClick={() =>
                            void runAndRefresh(() =>
                              forkDesktopAppServerAgentSession(session.sessionId)
                            )
                          }
                        >
                          Fork
                        </button>
                        <button
                          type="button"
                          className={controlButtonClass}
                          onClick={() =>
                            void runAndRefresh(() =>
                              cancelDesktopAppServerAgentSession(session.sessionId)
                            )
                          }
                        >
                          Cancel
                        </button>
                        {environment?.remoteConnected ? (
                          <button
                            type="button"
                            className={controlButtonClass}
                            onClick={() => void handoffAndRefresh(session.sessionId)}
                          >
                            Hand off to {environment.active === 'remote' ? 'Local' : 'Remote'}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>

          <aside className="space-y-4">
            {handoffMessage ? (
              <p className="rounded-lg border border-sky-400/30 bg-sky-500/10 p-3 text-sm text-sky-100">
                {handoffMessage}
              </p>
            ) : null}
            {message ? (
              <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
                {message}
              </p>
            ) : null}
            <DesktopAgentSummaryBlock
              title="Channels"
              rows={channels.map((channel) => `${channel.name} · ${channel.kind}`)}
            />
            <DesktopAgentSummaryBlock
              title="Schedules"
              rows={schedules.map((schedule) => `${schedule.name} · ${schedule.cadence}`)}
            />
            <button
              type="button"
              className="w-full rounded-md border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
              onClick={() => void runAndRefresh(() => tickDesktopAppServerSchedules())}
            >
              Run due schedules
            </button>
            <DesktopAgentSummaryBlock
              title="Diagnostics"
              rows={diagnostics.flatMap((section) =>
                section.items
                  .slice(0, 3)
                  .map((item) => `${section.title}: ${item.label} ${item.value}`)
              )}
            />
          </aside>
        </div>
      </section>
    </div>
  );
}
