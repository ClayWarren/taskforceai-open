'use client';

import { File, Folder, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  getDesktopWorkspaceFileTree,
  readDesktopWorkspaceFile,
  type DesktopWorkspaceFileReadResult,
  type DesktopWorkspaceFileTreeEntry,
  type DesktopWorkspaceFileTreeResult,
} from '../platform/app-server';
import { WorkspaceFileEditor } from './WorkspaceFileEditor';

interface WorkspaceFileTreePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertIntoComposer?: (text: string) => void;
}

const MAX_ENTRIES = 900;
const MAX_DEPTH = 7;

const matchesFilter = (entry: DesktopWorkspaceFileTreeEntry, filter: string): boolean => {
  if (!filter) return true;
  return entry.path.toLowerCase().includes(filter.toLowerCase());
};

export function WorkspaceFileTreePanel({
  isOpen,
  onClose,
  onInsertIntoComposer,
}: WorkspaceFileTreePanelProps) {
  const [tree, setTree] = useState<DesktopWorkspaceFileTreeResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<DesktopWorkspaceFileReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isEditorDirty, setIsEditorDirty] = useState(false);
  const [filter, setFilter] = useState('');
  const [activeRoot, setActiveRoot] = useState('');
  const treeRequestIdRef = useRef(0);
  const readRequestIdRef = useRef(0);

  const filteredEntries = useMemo(() => {
    const entries = tree?.entries ?? [];
    const trimmedFilter = filter.trim();
    return entries.filter((entry) => matchesFilter(entry, trimmedFilter));
  }, [filter, tree?.entries]);

  const loadTree = async (root = activeRoot) => {
    const requestId = ++treeRequestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await getDesktopWorkspaceFileTree({
        ...(root ? { root } : {}),
        maxDepth: MAX_DEPTH,
        maxEntries: MAX_ENTRIES,
      });
      if (requestId === treeRequestIdRef.current) {
        setTree(result);
        setActiveRoot(result.root);
      }
    } catch (loadError) {
      if (requestId === treeRequestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (requestId === treeRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  const openFile = async (entry: DesktopWorkspaceFileTreeEntry) => {
    if (entry.isDirectory) {
      return;
    }
    if (isEditorDirty && selectedFile?.path !== entry.path) {
      setError('Save or discard the current file edits before opening another file.');
      return;
    }
    const requestId = ++readRequestIdRef.current;
    setIsReadingFile(true);
    setError(null);
    try {
      const result = await readDesktopWorkspaceFile({
        ...(tree?.root ? { root: tree.root } : {}),
        path: entry.path,
        maxBytes: 128 * 1024,
      });
      if (requestId === readRequestIdRef.current) {
        setSelectedFile(result);
      }
    } catch (readError) {
      if (requestId === readRequestIdRef.current) {
        setError(readError instanceof Error ? readError.message : String(readError));
      }
    } finally {
      if (requestId === readRequestIdRef.current) {
        setIsReadingFile(false);
      }
    }
  };

  const confirmDiscardEdits = (): boolean =>
    !isEditorDirty || window.confirm('Discard the unsaved workspace file edits?');

  const changeRoot = (root: string) => {
    if (!confirmDiscardEdits()) return;
    setIsEditorDirty(false);
    setSelectedFile(null);
    setTree(null);
    void loadTree(root);
  };

  const closePanel = () => {
    if (!confirmDiscardEdits()) return;
    setIsEditorDirty(false);
    onClose();
  };

  useEffect(() => {
    if (isOpen && !tree && !isLoading) {
      void loadTree();
    }
  }, [isLoading, isOpen, tree]);

  useEffect(() => {
    if (!isOpen) {
      treeRequestIdRef.current += 1;
      readRequestIdRef.current += 1;
      setIsLoading(false);
      setIsReadingFile(false);
    }
  }, [isOpen]);

  useEffect(
    () => () => {
      treeRequestIdRef.current += 1;
      readRequestIdRef.current += 1;
    },
    []
  );

  if (!isOpen) {
    return null;
  }

  return (
    <aside
      className="fixed top-0 right-0 z-[320] flex h-screen w-full max-w-[440px] flex-col border-l border-blue-500/25 bg-[#060a14]/95 text-slate-100 shadow-[-20px_0_60px_rgba(2,6,23,0.5)] backdrop-blur-xl sm:w-[440px]"
      aria-label="Workspace files"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100">Files</h2>
          <p className="truncate text-xs text-slate-400">{tree?.root ?? 'Workspace'}</p>
        </div>
        {tree && (tree.roots?.length ?? 0) > 1 ? (
          <select
            aria-label="Workspace root"
            className="max-w-48 rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-xs"
            value={tree.root}
            onChange={(event) => changeRoot(event.target.value)}
          >
            {(tree.roots ?? []).map((root) => (
              <option key={root} value={root}>
                {root}
              </option>
            ))}
          </select>
        ) : null}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-100 transition hover:border-white/25 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void loadTree()}
            aria-label="Refresh files"
            disabled={isLoading}
          >
            <RefreshCw aria-hidden="true" size={17} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-100 transition hover:border-white/25 hover:bg-white/10"
            onClick={closePanel}
            aria-label="Close files"
          >
            <X aria-hidden="true" size={18} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="border-b border-white/10 px-4 py-3">
        <input
          type="search"
          aria-label="Filter workspace files"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter files"
          className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/35 focus:outline-none"
        />
      </div>

      {error ? (
        <div className="m-4 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="flex-1 overflow-auto px-2 py-3">
        {isLoading ? (
          <div className="px-3 py-2 text-sm text-slate-400" role="status">
            Loading files...
          </div>
        ) : null}

        {!isLoading && filteredEntries.length === 0 ? (
          <div className="px-3 py-2 text-sm text-slate-400">
            {tree ? 'No matching files.' : 'No files loaded.'}
          </div>
        ) : null}

        <ul className="space-y-0.5" aria-label="Workspace file tree">
          {filteredEntries.map((entry) => {
            const Icon = entry.isDirectory ? Folder : File;
            return (
              <li key={entry.path}>
                <button
                  type="button"
                  className="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-white/[0.06]"
                  style={{ paddingLeft: `${8 + entry.depth * 16}px` }}
                  title={entry.path}
                  onClick={() => void openFile(entry)}
                  aria-label={entry.isDirectory ? entry.path : `Open ${entry.path}`}
                >
                  <Icon
                    aria-hidden="true"
                    className={entry.isDirectory ? 'text-blue-300' : 'text-slate-400'}
                    size={16}
                    strokeWidth={2}
                  />
                  <span className="truncate font-mono text-xs">{entry.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <section className="max-h-[42vh] border-t border-white/10 bg-slate-950/40">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-slate-200">Preview</h3>
            <p className="truncate font-mono text-[11px] text-slate-400">
              {selectedFile?.path ?? 'Select a file'}
            </p>
          </div>
          {isReadingFile ? (
            <span className="shrink-0 text-[11px] text-slate-400" role="status">
              Loading...
            </span>
          ) : null}
        </div>
        <WorkspaceFileEditor
          file={selectedFile}
          isLoading={isReadingFile}
          onSaved={setSelectedFile}
          onInsertIntoComposer={onInsertIntoComposer}
          onDirtyChange={setIsEditorDirty}
        />
      </section>

      {tree?.truncated ? (
        <div className="border-t border-white/10 px-4 py-2 text-xs text-slate-400">
          Showing first {tree.entries.length} entries.
        </div>
      ) : null}
    </aside>
  );
}
