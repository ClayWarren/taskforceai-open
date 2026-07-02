import type { FC } from 'react';
import { COMPUTER_THEATER_COPY, type ComputerTheaterViewModel } from '@taskforceai/shared';

import { ActivityIcon, MinimizeIcon, MonitorIcon } from '../../lib/prompt/prompt-icons';
import type { ComputerUseSessionMode } from '../../lib/prompt/computer-use-session-mode';

interface ComputerTheaterOverlayProps {
  viewModel: ComputerTheaterViewModel;
  displayAgentLabel: string;
  isStreaming: boolean;
  sessionMode: ComputerUseSessionMode;
  pendingModeChange: boolean;
  onClose: () => void;
  onModeSelect: (mode: ComputerUseSessionMode) => void;
}

export const ComputerTheaterOverlay: FC<ComputerTheaterOverlayProps> = ({
  viewModel,
  displayAgentLabel,
  isStreaming,
  sessionMode,
  pendingModeChange,
  onClose,
  onModeSelect,
}) => {
  const { actionLogs, cursor, imageSource, screenMessage, screenshot, statusText } = viewModel;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 duration-300 animate-in fade-in">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-6 py-4 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600/20">
            <MonitorIcon className="h-6 w-6 text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-wider text-white uppercase">
              {COMPUTER_THEATER_COPY.modeTitle}
            </h3>
            <p className="text-xs text-slate-400">
              {displayAgentLabel} &middot; {statusText}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isStreaming && (
            <div className="flex items-center gap-2 rounded-full bg-blue-500/10 px-3 py-1 ring-1 ring-blue-500/30">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
              </span>
              <span className="text-[10px] font-bold tracking-tighter text-blue-400 uppercase">
                {COMPUTER_THEATER_COPY.liveFollow}
              </span>
            </div>
          )}
          <button
            onClick={onClose}
            className="ml-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
            title="Close Theater"
          >
            <MinimizeIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden bg-black p-4 md:p-8">
        <div className="mx-auto h-full max-w-6xl shadow-2xl shadow-blue-500/10">
          {screenshot ? (
            <div className="relative h-full w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-900 ring-1 ring-white/5">
              <img
                src={imageSource ?? ''}
                alt="Live Desktop View"
                className="h-full w-full object-contain"
              />
              {cursor && (
                <div
                  className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-white bg-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                  style={{ left: cursor.left, top: cursor.top }}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-1 w-1 rounded-full bg-white" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-slate-800 text-slate-500">
              <div className="relative">
                <MonitorIcon className="h-16 w-16 opacity-10" />
                <ActivityIcon className="absolute -top-2 -right-2 h-6 w-6 animate-pulse text-blue-500/50" />
              </div>
              <p className="max-w-xl px-6 text-center text-sm font-medium break-words">
                {screenMessage}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="h-48 overflow-y-auto border-t border-slate-800 bg-slate-900/50 p-6 backdrop-blur-md">
        <div className="mx-auto max-w-6xl">
          <h4 className="mb-4 text-[10px] font-bold tracking-widest text-slate-500 uppercase">
            {COMPUTER_THEATER_COPY.recentActions}
          </h4>
          <div className="flex flex-col gap-2">
            {actionLogs.map((event, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 text-xs ${
                  i === 0 ? 'text-slate-100' : 'text-slate-500'
                }`}
              >
                <span className="font-mono text-[10px] opacity-50">{event.timestamp}</span>
                <span className="font-bold tracking-tighter text-blue-400 uppercase">
                  [{event.toolName}]
                </span>
                <span>{event.argumentsText}</span>
                {i === 0 && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                )}
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                  {COMPUTER_THEATER_COPY.browserSessionTitle}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {COMPUTER_THEATER_COPY.browserSessionDescription}
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-1">
                <button
                  type="button"
                  onClick={() => onModeSelect('logged_out')}
                  className={`rounded-md px-3 py-1.5 text-[11px] font-bold uppercase transition ${
                    sessionMode === 'logged_out'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Logged Out
                </button>
                <button
                  type="button"
                  onClick={() => onModeSelect('logged_in')}
                  className={`rounded-md px-3 py-1.5 text-[11px] font-bold uppercase transition ${
                    sessionMode === 'logged_in'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Logged In
                </button>
              </div>
            </div>
            {pendingModeChange && (
              <p className="mt-2 text-[11px] text-amber-300">
                {COMPUTER_THEATER_COPY.pendingModeChange}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
