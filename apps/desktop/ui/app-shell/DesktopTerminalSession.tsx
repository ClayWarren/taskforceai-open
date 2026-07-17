'use client';

import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

import type { TerminalLaunchConfig } from '../platform/app-server-types';
import {
  killDesktopProcess,
  readDesktopProcess,
  resizeDesktopProcess,
  startDesktopProcess,
  writeDesktopProcess,
} from '../platform/app-server';

const READ_INTERVAL_MS = 65;

export function DesktopTerminalSession(props: {
  active: boolean;
  config: TerminalLaunchConfig;
  onExited: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const processIdRef = useRef<string | null>(null);
  const cursorRef = useRef(0);
  const activeRef = useRef(props.active);
  const onExitedRef = useRef(props.onExited);

  activeRef.current = props.active;
  onExitedRef.current = props.onExited;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      theme: {
        background: '#020617',
        foreground: '#e2e8f0',
        cursor: '#93c5fd',
        selectionBackground: '#1d4ed880',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();

    let disposed = false;
    let readTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRead = () => {
      if (!disposed) readTimer = setTimeout(() => void readOutput(), READ_INTERVAL_MS);
    };
    const readOutput = async () => {
      const processId = processIdRef.current;
      if (!processId || disposed) return;
      try {
        const result = await readDesktopProcess({
          processId,
          cursor: cursorRef.current,
          limit: 64 * 1024,
        });
        cursorRef.current = result.nextCursor;
        if (result.data) terminal.write(result.data);
        if (result.eof) {
          terminal.writeln(`\r\n[process ${result.process.status}]`);
          onExitedRef.current();
          return;
        }
      } catch (error) {
        terminal.writeln(`\r\n[terminal read failed: ${String(error)}]`);
        return;
      }
      scheduleRead();
    };

    const start = async () => {
      try {
        const result = await startDesktopProcess({
          command: props.config.command,
          args: props.config.args,
          cwd: props.config.cwd,
          workspaceRoot: props.config.workspaceRoot,
          cols: terminal.cols,
          rows: terminal.rows,
          permissionProfile: 'full_access',
        });
        if (disposed) {
          await killDesktopProcess(result.process.id).catch(() => undefined);
          return;
        }
        processIdRef.current = result.process.id;
        scheduleRead();
      } catch (error) {
        terminal.writeln(`[terminal failed to start: ${String(error)}]`);
        onExitedRef.current();
      }
    };

    const dataDisposable = terminal.onData((data) => {
      const processId = processIdRef.current;
      if (processId) void writeDesktopProcess({ processId, data });
    });
    const resizeObserver = new ResizeObserver(() => {
      if (!activeRef.current) return;
      fitAddon.fit();
      const processId = processIdRef.current;
      if (processId) {
        void resizeDesktopProcess({ processId, cols: terminal.cols, rows: terminal.rows });
      }
    });
    resizeObserver.observe(container);
    void start();

    return () => {
      disposed = true;
      if (readTimer) clearTimeout(readTimer);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      const processId = processIdRef.current;
      processIdRef.current = null;
      if (processId) void killDesktopProcess(processId).catch(() => undefined);
    };
  }, [props.config]);

  return <div ref={containerRef} className="h-full w-full bg-slate-950 p-2" />;
}
