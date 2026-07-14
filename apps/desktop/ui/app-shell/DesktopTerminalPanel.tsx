'use client';

import { X } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';

import { logger } from '@taskforceai/web/app/lib/logger';
import { invokeTauri } from '../platform/bridge';

interface DesktopTerminalPanelProps {
  open: boolean;
  onClose: () => void;
}

interface TerminalExecuteResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface TerminalEntry {
  id: number;
  command: string;
  cwd?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export function DesktopTerminalPanel({ open, onClose }: DesktopTerminalPanelProps) {
  const [command, setCommand] = useState('');
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!outputRef.current) {
      return;
    }
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [entries]);

  if (!open) {
    return null;
  }

  const runCommand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed || isRunning) {
      return;
    }

    if (trimmed === 'clear') {
      setEntries([]);
      setCommand('');
      return;
    }

    setCommand('');
    setIsRunning(true);
    try {
      const result = await invokeTauri<TerminalExecuteResult>('terminal_execute', {
        command: trimmed,
      });
      setEntries((current) => [
        ...current,
        {
          id: Date.now(),
          command: result.command,
          cwd: result.cwd,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      ]);
    } catch (error) {
      logger.error('Desktop terminal command failed', { error, command: trimmed });
      setEntries((current) => [
        ...current,
        {
          id: Date.now(),
          command: trimmed,
          error: error instanceof Error ? error.message : String(error),
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section
      className="fixed right-6 bottom-6 z-[270] flex h-[min(420px,48vh)] w-[min(760px,calc(100vw-8rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/96 text-slate-100 shadow-[0_24px_70px_rgba(2,6,23,0.62)] backdrop-blur-xl"
      aria-label="Desktop terminal"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Terminal</h3>
          <p className="text-xs text-slate-400">Runs commands in the desktop app workspace.</p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
          onClick={onClose}
          aria-label="Close terminal"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>

      <div ref={outputRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-3 font-mono text-xs">
        {entries.length === 0 ? (
          <p className="text-slate-500">Type a command below. Use clear to reset the panel.</p>
        ) : null}
        {entries.map((entry) => (
          <div key={entry.id} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-blue-200">
              <span>$</span>
              <span>{entry.command}</span>
              {entry.exitCode !== undefined ? (
                <span className="text-slate-500">exit {entry.exitCode ?? 'signal'}</span>
              ) : null}
            </div>
            {entry.cwd ? <p className="text-[11px] text-slate-500">{entry.cwd}</p> : null}
            {entry.stdout ? (
              <pre className="whitespace-pre-wrap text-slate-200">{entry.stdout}</pre>
            ) : null}
            {entry.stderr ? (
              <pre className="whitespace-pre-wrap text-amber-200">{entry.stderr}</pre>
            ) : null}
            {entry.error ? (
              <pre className="whitespace-pre-wrap text-red-300">{entry.error}</pre>
            ) : null}
          </div>
        ))}
      </div>

      <form
        onSubmit={(event) => void runCommand(event)}
        className="flex items-center gap-2 border-t border-white/10 px-4 py-3"
      >
        <span className="font-mono text-sm text-blue-200">$</span>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-white placeholder:text-slate-500 focus:outline-none"
          placeholder={isRunning ? 'Running...' : 'Command'}
          disabled={isRunning}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
        />
      </form>
    </section>
  );
}
