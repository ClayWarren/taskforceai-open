import React, { useState, useEffect, useMemo } from 'react';
import {
  COMPUTER_THEATER_COPY,
  createComputerTheaterAgentLabel,
  createComputerTheaterViewModel,
} from '@taskforceai/shared';
import type { ToolUsageEvent } from '../../lib/types';
import { MonitorIcon, MaximizeIcon, ActivityIcon } from '../../lib/prompt/prompt-icons';
import {
  persistComputerUseSessionMode,
  readStoredComputerUseSessionMode,
  type ComputerUseSessionMode,
} from '../../lib/prompt/computer-use-session-mode';
import { ComputerTheaterOverlay } from './ComputerTheaterOverlay';

interface ComputerTheaterProps {
  toolEvents: ToolUsageEvent[];
  agentLabel?: string;
  isStreaming: boolean;
  useLoggedInServices?: boolean;
  autoExpand?: boolean;
  showWhenEmpty?: boolean;
  preScreenStatus?: string | null;
}

export const ComputerTheater: React.FC<ComputerTheaterProps> = ({
  toolEvents,
  agentLabel,
  isStreaming,
  useLoggedInServices = false,
  autoExpand = true,
  showWhenEmpty = false,
  preScreenStatus = null,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sessionMode, setSessionMode] = useState<ComputerUseSessionMode>('logged_out');

  const viewModel = useMemo(
    () => createComputerTheaterViewModel(toolEvents, { isStreaming, preScreenStatus }),
    [isStreaming, preScreenStatus, toolEvents]
  );
  const { computerEvents, imageSource, latestEvent, screenMessage, screenshot } = viewModel;
  const displayAgentLabel = createComputerTheaterAgentLabel(agentLabel);

  // Auto-expand logic: if a new computer event arrives and we're streaming
  useEffect(() => {
    if (autoExpand && isStreaming && latestEvent && !isExpanded) {
      setIsExpanded(true);
    }
  }, [latestEvent, isStreaming, autoExpand, isExpanded]);

  useEffect(() => {
    const storedMode = readStoredComputerUseSessionMode();
    if (storedMode === 'logged_in' || storedMode === 'logged_out') {
      setSessionMode(storedMode);
      return;
    }
    setSessionMode(useLoggedInServices ? 'logged_in' : 'logged_out');
  }, [useLoggedInServices]);

  useEffect(() => {
    if (!isExpanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExpanded(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  const activeRunMode: ComputerUseSessionMode = useLoggedInServices ? 'logged_in' : 'logged_out';
  const pendingModeChange = sessionMode !== activeRunMode;

  const handleModeSelect = (mode: ComputerUseSessionMode) => {
    setSessionMode(mode);
    persistComputerUseSessionMode(mode);
  };

  if (computerEvents.length === 0 && !showWhenEmpty) return null;
  if (computerEvents.length === 0 && showWhenEmpty) {
    // Show a waiting/initializing state when computer use is active but no events yet
    return (
      <div className="computer-theater-trigger mt-2 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/50">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/30 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <MonitorIcon className="h-3.5 w-3.5 text-blue-400" />
            <span>{COMPUTER_THEATER_COPY.activeTitle}</span>
            {isStreaming && (
              <span className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500"></span>
            )}
          </div>
        </div>
        <div className="flex aspect-video items-center justify-center bg-black/40 text-slate-500">
          <div className="flex flex-col items-center gap-3">
            <ActivityIcon className="h-8 w-8 animate-pulse opacity-20" />
            <span className="text-xs">{screenMessage}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Compact View / Trigger in the Chat */}
      <div className="computer-theater-trigger mt-2 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/50 transition-all hover:border-blue-500/50">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/30 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <MonitorIcon className="h-3.5 w-3.5 text-blue-400" />
            <span>{displayAgentLabel} is using Computer</span>
            {isStreaming && (
              <span className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500"></span>
            )}
          </div>
          <button
            onClick={() => setIsExpanded(true)}
            className="flex items-center gap-1 text-[10px] font-bold text-blue-400 uppercase transition hover:text-blue-300"
          >
            <MaximizeIcon className="h-3 w-3" />
            View Live
          </button>
        </div>

        <div
          className="group relative aspect-video cursor-pointer bg-black/40"
          onClick={() => setIsExpanded(true)}
        >
          {screenshot ? (
            <img
              src={imageSource ?? ''}
              alt="Computer Screenshot"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-slate-500">
              <ActivityIcon className="h-8 w-8 opacity-20" />
              <span className="max-w-full px-3 text-center text-xs break-words">
                {screenMessage}
              </span>
            </div>
          )}

          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
            <div className="rounded-full bg-slate-900/80 p-3 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
              <MaximizeIcon className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <ComputerTheaterOverlay
          viewModel={viewModel}
          displayAgentLabel={displayAgentLabel}
          isStreaming={isStreaming}
          sessionMode={sessionMode}
          pendingModeChange={pendingModeChange}
          onClose={() => setIsExpanded(false)}
          onModeSelect={handleModeSelect}
        />
      )}
    </>
  );
};
