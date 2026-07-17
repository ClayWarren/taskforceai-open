'use client';

import { Command, File, MessageSquare } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ConversationRecord } from '../../lib/platform/platform-interfaces';
import type { DesktopWorkspaceFileTreeResult } from '@taskforceai/contracts/app-server';
import { invokeTauri } from '../../lib/platform/desktop-api';
import { logger } from '../../lib/logger';
import type { DesktopCommandDescriptor } from '../../lib/commands/desktop-command-bindings';
import { displayDesktopBinding } from '../../lib/commands/desktop-command-bindings';

export type DesktopCommandPaletteItem = DesktopCommandDescriptor & {
  binding: string;
  run: () => void;
};

type PaletteItem = {
  key: string;
  label: string;
  description: string;
  kind: 'command' | 'task' | 'file';
  binding?: string;
  run: () => void;
};

export function DesktopCommandPalette({
  open,
  commands,
  includeFiles,
  loadTasks,
  onTaskSelect,
  onFileSelect,
  onClose,
}: {
  open: boolean;
  commands: DesktopCommandPaletteItem[];
  includeFiles: boolean;
  loadTasks?: () => Promise<ConversationRecord[]>;
  onTaskSelect: (_record: ConversationRecord) => void | Promise<void>;
  onFileSelect: (_path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState<ConversationRecord[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<PaletteItem[]>(
    () => [
      ...commands.map((command) => ({
        key: `command:${command.id}`,
        label: command.label,
        description: command.group,
        kind: 'command' as const,
        binding: command.binding,
        run: command.run,
      })),
      ...tasks.map((task) => ({
        key: `task:${task.conversationId}`,
        label: task.title,
        description: task.lastMessagePreview ?? 'Task',
        kind: 'task' as const,
        run: () => void onTaskSelect(task),
      })),
      ...files.map((path) => ({
        key: `file:${path}`,
        label: path.split('/').at(-1) ?? path,
        description: path,
        kind: 'file' as const,
        run: () => onFileSelect(path),
      })),
    ],
    [commands, files, onFileSelect, onTaskSelect, tasks]
  );

  const matches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        !normalizedQuery ||
        `${item.label} ${item.description}`.toLowerCase().includes(normalizedQuery)
    );
  }, [items, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
    let canceled = false;
    const loadEntities = async () => {
      try {
        const [nextTasks, tree] = await Promise.all([
          loadTasks?.() ?? Promise.resolve([]),
          includeFiles
            ? invokeTauri<DesktopWorkspaceFileTreeResult>('workspace_file_tree', {
                params: { maxDepth: 10, maxEntries: 1200 },
              })
            : Promise.resolve(null),
        ]);
        if (!canceled) {
          setTasks(nextTasks);
          setFiles(
            tree?.entries.filter((entry) => !entry.isDirectory).map((entry) => entry.path) ?? []
          );
        }
      } catch (error) {
        logger.error('Failed to load command palette entities', { error });
      }
    };
    void loadEntities();
    return () => {
      canceled = true;
    };
  }, [includeFiles, loadTasks, open]);

  if (!open) return null;
  const run = (item: PaletteItem) => {
    onClose();
    item.run();
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/55 px-4 pt-[14vh] backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/12 bg-slate-950/95 shadow-[0_28px_90px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4">
          <Command className="h-4 w-4 text-blue-300" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'Enter' && matches[0]) run(matches[0]);
            }}
            placeholder={
              includeFiles ? 'Search commands, tasks, and files' : 'Search commands and tasks'
            }
            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
          <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-500">
            Esc
          </kbd>
        </div>
        <div className="max-h-[58vh] overflow-y-auto p-2">
          {matches.map((item) => (
            <button
              key={item.key}
              type="button"
              className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/8 hover:text-white focus:bg-blue-500/15 focus:outline-none"
              onClick={() => run(item)}
            >
              <span className="flex min-w-0 items-center gap-3">
                {item.kind === 'task' ? (
                  <MessageSquare size={15} className="shrink-0 text-violet-300" />
                ) : item.kind === 'file' ? (
                  <File size={15} className="shrink-0 text-emerald-300" />
                ) : (
                  <Command size={15} className="shrink-0 text-blue-300" />
                )}
                <span className="min-w-0">
                  <span className="block truncate">{item.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                    {item.kind} · {item.description}
                  </span>
                </span>
              </span>
              {item.binding ? (
                <kbd className="shrink-0 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-400">
                  {displayDesktopBinding(item.binding)}
                </kbd>
              ) : null}
            </button>
          ))}
          {matches.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-slate-500">
              No matching commands, tasks, or files.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
