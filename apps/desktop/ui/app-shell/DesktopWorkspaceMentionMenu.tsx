'use client';

import { File, Folder } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  getDesktopWorkspaceFileTree,
  type DesktopWorkspaceFileTreeEntry,
} from '../platform/app-server';

export function DesktopWorkspaceMentionMenu(props: {
  query: string;
  onSelect: (_path: string) => void;
}) {
  const [entries, setEntries] = useState<DesktopWorkspaceFileTreeEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getDesktopWorkspaceFileTree({ maxDepth: 8, maxEntries: 1_500 })
      .then((result) => {
        if (active) setEntries(result.entries);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Files unavailable.');
      });
    return () => {
      active = false;
    };
  }, []);

  const matches = useMemo(() => {
    const query = props.query.trim().toLowerCase();
    return entries
      .filter((entry) => !query || entry.path.toLowerCase().includes(query))
      .toSorted((left, right) => {
        const leftStarts = left.path.toLowerCase().startsWith(query) ? 0 : 1;
        const rightStarts = right.path.toLowerCase().startsWith(query) ? 0 : 1;
        return leftStarts - rightStarts || left.path.localeCompare(right.path);
      })
      .slice(0, 12);
  }, [entries, props.query]);

  return (
    <div
      role="listbox"
      aria-label="Workspace mentions"
      className="absolute right-3 bottom-[calc(100%+0.5rem)] left-3 z-40 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/95 p-2 text-left shadow-[0_18px_50px_rgba(2,6,23,0.55)] backdrop-blur-xl"
    >
      <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase">
        <span>Files and folders</span>
        <span className="tracking-normal normal-case">@{props.query}</span>
      </div>
      {error ? <p className="px-2 py-2 text-xs text-rose-200">{error}</p> : null}
      {!error && matches.length === 0 ? (
        <p className="px-2 py-2 text-xs text-slate-400">No workspace matches.</p>
      ) : null}
      {matches.map((entry) => (
        <button
          key={entry.path}
          type="button"
          role="option"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/7 hover:text-white"
          onMouseDown={(event) => {
            event.preventDefault();
            props.onSelect(entry.path);
          }}
        >
          {entry.isDirectory ? (
            <Folder className="h-4 w-4 shrink-0 text-blue-300" />
          ) : (
            <File className="h-4 w-4 shrink-0 text-slate-400" />
          )}
          <span className="truncate font-mono text-xs">{entry.path}</span>
        </button>
      ))}
    </div>
  );
}
