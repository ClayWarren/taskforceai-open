'use client';

import { Columns2, Rows3 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  highlightCode,
  loadPrism,
  sanitizePrismHtml,
  type PrismLike,
} from '@taskforceai/web/app/components/tool-usage/prism';
import type { AppServerGitReviewComment } from '../platform/app-server';

type ReviewLineKind = 'context' | 'addition' | 'deletion' | 'hunk' | 'meta';

export type ReviewCodeLine = {
  content: string;
  kind: ReviewLineKind;
  newLine: number | null;
  oldLine: number | null;
  text: string;
};

export type ReviewCodeFile = {
  additions: number;
  deletions: number;
  lines: ReviewCodeLine[];
  path: string;
};

export type ReviewCodeSelection = {
  endLine?: number;
  line: number;
  path: string;
};

type ReviewLayout = 'unified' | 'split';
type SelectedRange = { anchor: number; end: number; path: string };

const DEFAULT_VISIBLE_LINES = 240;

const normalizeDiffPath = (value: string): string | null => {
  const path = value
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/^[ab]\//, '');
  return path && path !== '/dev/null' ? path : null;
};

export const parseReviewDiff = (rawDiff: string): ReviewCodeFile[] => {
  const files: ReviewCodeFile[] = [];
  let current: ReviewCodeFile | null = null;
  let pendingPath: string | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const text of rawDiff.trimEnd().split(/\r?\n/)) {
    if (text.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(text);
      pendingPath = match?.[2] ?? match?.[1] ?? null;
      current = null;
      continue;
    }
    if (text.startsWith('--- ')) {
      pendingPath = normalizeDiffPath(text.slice(4)) ?? pendingPath;
      continue;
    }
    if (text.startsWith('+++ ')) {
      const path = normalizeDiffPath(text.slice(4)) ?? pendingPath ?? 'changed file';
      current = { additions: 0, deletions: 0, lines: [], path };
      files.push(current);
      pendingPath = null;
      continue;
    }
    if (!current) continue;

    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number.parseInt(hunk[1] ?? '0', 10);
      newLine = Number.parseInt(hunk[2] ?? '0', 10);
      current.lines.push({ content: text, kind: 'hunk', newLine: null, oldLine: null, text });
      continue;
    }
    if (text.startsWith('\\ No newline')) {
      current.lines.push({ content: text, kind: 'meta', newLine: null, oldLine: null, text });
      continue;
    }
    if (text.startsWith('+')) {
      current.lines.push({
        content: text.slice(1),
        kind: 'addition',
        newLine,
        oldLine: null,
        text,
      });
      current.additions += 1;
      newLine += 1;
      continue;
    }
    if (text.startsWith('-')) {
      current.lines.push({
        content: text.slice(1),
        kind: 'deletion',
        newLine: null,
        oldLine,
        text,
      });
      current.deletions += 1;
      oldLine += 1;
      continue;
    }
    const content = text.startsWith(' ') ? text.slice(1) : text;
    current.lines.push({ content, kind: 'context', newLine, oldLine, text });
    oldLine += 1;
    newLine += 1;
  }

  return files;
};

const languageForPath = (path: string): string | undefined => {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'ts' || extension === 'tsx') return 'typescript';
  if (extension === 'js' || extension === 'jsx' || extension === 'mjs') return 'javascript';
  if (extension === 'py') return 'python';
  if (extension === 'sh' || extension === 'bash' || extension === 'zsh') return 'bash';
  if (extension === 'rs') return 'rust';
  if (extension === 'go') return 'go';
  if (extension === 'json') return 'json';
  if (extension === 'yaml' || extension === 'yml') return 'yaml';
  return undefined;
};

const lineClassName = (kind: ReviewLineKind, selected: boolean) => {
  if (selected) return 'bg-sky-500/25 text-sky-50';
  if (kind === 'addition') return 'bg-emerald-500/10 text-emerald-100';
  if (kind === 'deletion') return 'bg-rose-500/10 text-rose-100';
  if (kind === 'hunk') return 'bg-sky-500/10 text-sky-200';
  if (kind === 'meta') return 'bg-slate-900/80 text-slate-500';
  return 'text-slate-300';
};

const highlightedLine = (line: ReviewCodeLine, path: string, prism: PrismLike | null) => {
  if (line.kind === 'hunk' || line.kind === 'meta') return null;
  const highlight = highlightCode(
    { code: line.content || ' ', language: languageForPath(path) },
    prism
  );
  return highlight.html ? sanitizePrismHtml(highlight.html) : null;
};

const commentCountForLine = (comments: AppServerGitReviewComment[], path: string, line: number) =>
  comments.filter(
    (comment) =>
      comment.path === path && line >= comment.line && line <= (comment.endLine ?? comment.line)
  ).length;

interface CodeCellProps {
  comments: AppServerGitReviewComment[];
  line: ReviewCodeLine | null;
  onSelect: (_line: number, _shiftKey: boolean) => void;
  path: string;
  prism: PrismLike | null;
  selected: boolean;
  side: 'old' | 'new';
}

function CodeCell({ comments, line, onSelect, path, prism, selected, side }: CodeCellProps) {
  if (!line) return <div className="min-h-6 bg-slate-950/50" />;
  const lineNumber = side === 'old' ? line.oldLine : line.newLine;
  const commentCount = lineNumber ? commentCountForLine(comments, path, lineNumber) : 0;
  const html = highlightedLine(line, path, prism);

  return (
    <div
      className={`grid min-h-6 grid-cols-[3.5rem_minmax(0,1fr)] ${lineClassName(line.kind, selected)}`}
    >
      {lineNumber ? (
        <button
          type="button"
          className="border-r border-white/5 px-2 text-right font-mono text-[11px] text-slate-500 hover:bg-sky-500/20 hover:text-sky-200"
          aria-label={`Comment on ${path} line ${lineNumber}`}
          aria-pressed={selected}
          onClick={(event) => onSelect(lineNumber, event.shiftKey)}
        >
          {lineNumber}
          {commentCount ? <span className="ml-1 text-sky-300">●</span> : null}
        </button>
      ) : (
        <span className="border-r border-white/5" />
      )}
      <code className="review-code-line block min-w-max px-3 font-mono text-xs leading-6">
        {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : line.content || ' '}
      </code>
    </div>
  );
}

function FullWidthLine({ line }: { line: ReviewCodeLine }) {
  return (
    <code
      className={`block min-h-6 min-w-max px-3 font-mono text-xs leading-6 ${lineClassName(line.kind, false)}`}
    >
      {line.text || ' '}
    </code>
  );
}

export function ReviewCodeSurface(props: {
  comments?: AppServerGitReviewComment[];
  emptyMessage?: string;
  initialMaxLines?: number;
  onSelectRange?: (_selection: ReviewCodeSelection) => void;
  rawDiff: string;
}) {
  const files = useMemo(() => parseReviewDiff(props.rawDiff), [props.rawDiff]);
  const [selectedPath, setSelectedPath] = useState('');
  const [layout, setLayout] = useState<ReviewLayout>('unified');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [selection, setSelection] = useState<SelectedRange | null>(null);
  const [prism, setPrism] = useState<PrismLike | null>(null);
  const comments = props.comments ?? [];
  const maxLines = props.initialMaxLines ?? DEFAULT_VISIBLE_LINES;
  const activeFile = files.find((file) => file.path === selectedPath) ?? files[0];

  useEffect(() => {
    if (!files.some((file) => file.path === selectedPath)) setSelectedPath(files[0]?.path ?? '');
  }, [files, selectedPath]);

  useEffect(() => {
    let active = true;
    void loadPrism()
      .then((instance) => {
        if (active) setPrism(instance as PrismLike);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!activeFile) {
    return <p className="mt-3 text-xs text-slate-500">{props.emptyMessage ?? 'No changes.'}</p>;
  }

  const expanded = expandedPaths.has(activeFile.path);
  const visibleLines = expanded ? activeFile.lines : activeFile.lines.slice(0, maxLines);
  const hiddenLineCount = activeFile.lines.length - visibleLines.length;
  const language = languageForPath(activeFile.path);

  const selectLine = (line: number, shiftKey: boolean) => {
    const anchor = shiftKey && selection?.path === activeFile.path ? selection.anchor : line;
    const nextSelection = { anchor, end: line, path: activeFile.path };
    setSelection(nextSelection);
    const start = Math.min(anchor, line);
    const end = Math.max(anchor, line);
    props.onSelectRange?.({
      path: activeFile.path,
      line: start,
      ...(end !== start ? { endLine: end } : {}),
    });
  };

  const isSelected = (line: ReviewCodeLine, side: 'old' | 'new') => {
    if (!selection || selection.path !== activeFile.path) return false;
    const number = side === 'old' ? line.oldLine : line.newLine;
    if (!number) return false;
    return (
      number >= Math.min(selection.anchor, selection.end) &&
      number <= Math.max(selection.anchor, selection.end)
    );
  };

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-700/70 bg-slate-950/60">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-2 text-xs">
        <span className="font-semibold text-slate-200">
          {files.length} changed {files.length === 1 ? 'file' : 'files'}
        </span>
        <span className="font-mono text-emerald-300">
          +{files.reduce((total, file) => total + file.additions, 0)}
        </span>
        <span className="font-mono text-rose-300">
          -{files.reduce((total, file) => total + file.deletions, 0)}
        </span>
        <div className="ml-auto flex rounded-md border border-white/10 bg-slate-900 p-0.5">
          <button
            type="button"
            className={`rounded p-1.5 ${layout === 'unified' ? 'bg-white/10 text-white' : 'text-slate-500'}`}
            aria-label="Unified diff"
            aria-pressed={layout === 'unified'}
            onClick={() => setLayout('unified')}
          >
            <Rows3 size={14} />
          </button>
          <button
            type="button"
            className={`rounded p-1.5 ${layout === 'split' ? 'bg-white/10 text-white' : 'text-slate-500'}`}
            aria-label="Split diff"
            aria-pressed={layout === 'split'}
            onClick={() => setLayout('split')}
          >
            <Columns2 size={14} />
          </button>
        </div>
      </div>
      <div className="grid min-h-52 md:grid-cols-[minmax(150px,220px)_minmax(0,1fr)]">
        <nav
          className="max-h-[32rem] overflow-auto border-b border-slate-800 bg-slate-950/70 p-2 md:border-r md:border-b-0"
          aria-label="Changed files"
        >
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              aria-current={file.path === activeFile.path ? 'page' : undefined}
              className={`mb-1 flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${file.path === activeFile.path ? 'bg-sky-500/15 text-sky-100' : 'text-slate-400 hover:bg-white/5'}`}
              onClick={() => {
                setSelectedPath(file.path);
                setSelection(null);
              }}
            >
              <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
              <span className="shrink-0 font-mono text-[10px]">
                <span className="text-emerald-400">+{file.additions}</span>{' '}
                <span className="text-rose-400">-{file.deletions}</span>
              </span>
            </button>
          ))}
        </nav>
        <section className="min-w-0">
          <header className="flex min-w-0 items-center gap-2 border-b border-slate-800 bg-slate-900/70 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-slate-200">
              {activeFile.path}
            </span>
            {language ? (
              <span className="text-[10px] text-slate-500 uppercase">{language}</span>
            ) : null}
          </header>
          <div className="max-h-[32rem] overflow-auto">
            {layout === 'unified'
              ? visibleLines.map((line, index) =>
                  line.kind === 'hunk' || line.kind === 'meta' ? (
                    <FullWidthLine key={`${line.text}-${index}`} line={line} />
                  ) : (
                    <CodeCell
                      key={`${line.text}-${index}`}
                      comments={comments}
                      line={line}
                      onSelect={selectLine}
                      path={activeFile.path}
                      prism={prism}
                      selected={isSelected(line, line.newLine ? 'new' : 'old')}
                      side={line.newLine ? 'new' : 'old'}
                    />
                  )
                )
              : visibleLines.map((line, index) =>
                  line.kind === 'hunk' || line.kind === 'meta' ? (
                    <FullWidthLine key={`${line.text}-${index}`} line={line} />
                  ) : (
                    <div
                      key={`${line.text}-${index}`}
                      className="grid min-w-[760px] grid-cols-2 border-b border-white/[0.025]"
                    >
                      <CodeCell
                        comments={comments}
                        line={line.kind === 'addition' ? null : line}
                        onSelect={selectLine}
                        path={activeFile.path}
                        prism={prism}
                        selected={isSelected(line, 'old')}
                        side="old"
                      />
                      <CodeCell
                        comments={comments}
                        line={line.kind === 'deletion' ? null : line}
                        onSelect={selectLine}
                        path={activeFile.path}
                        prism={prism}
                        selected={isSelected(line, 'new')}
                        side="new"
                      />
                    </div>
                  )
                )}
          </div>
          {hiddenLineCount > 0 ? (
            <button
              type="button"
              className="w-full border-t border-slate-800 px-3 py-2 text-xs text-sky-300 hover:bg-white/5"
              onClick={() => setExpandedPaths((current) => new Set([...current, activeFile.path]))}
            >
              Show {hiddenLineCount} more lines
            </button>
          ) : null}
        </section>
      </div>
      {props.onSelectRange ? (
        <p className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">
          Click a line number to comment. Shift-click another line to select a range.
        </p>
      ) : null}
    </div>
  );
}
