'use client';

import React from 'react';
import type {
  DiffPreview as DiffPreviewModel,
  DiffPreviewLine,
} from '@taskforceai/shared/tool-usage/parsers';

interface DiffPreviewProps {
  diff: DiffPreviewModel;
  maxLinesPerFile?: number;
}

const lineClassName = (line: DiffPreviewLine): string => {
  switch (line.kind) {
    case 'addition':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
    case 'deletion':
      return 'border-rose-500/20 bg-rose-500/10 text-rose-200';
    case 'hunk':
      return 'border-sky-500/20 bg-sky-500/10 text-sky-200';
    case 'meta':
      return 'border-slate-700/60 bg-slate-950/30 text-slate-500';
    case 'context':
      return 'border-slate-800/60 text-slate-300';
  }
};

export const DiffPreview: React.FC<DiffPreviewProps> = ({ diff, maxLinesPerFile = 80 }) => {
  if (diff.files.length === 0) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-700/70 bg-slate-950/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-2 text-xs">
        <span className="font-semibold text-slate-200">
          {diff.files.length} changed {diff.files.length === 1 ? 'file' : 'files'}
        </span>
        <span className="font-mono text-emerald-300">+{diff.additions}</span>
        <span className="font-mono text-rose-300">-{diff.deletions}</span>
      </div>
      <div className="max-h-96 overflow-auto">
        {diff.files.map((file) => {
          const visibleLines = file.lines.slice(0, maxLinesPerFile);
          const hiddenCount = file.lines.length - visibleLines.length;

          return (
            <section key={file.path} className="border-b border-slate-800/70 last:border-b-0">
              <div className="flex min-w-0 items-center justify-between gap-3 bg-slate-900/60 px-3 py-2">
                <span className="truncate font-mono text-xs font-semibold text-slate-200">
                  {file.path}
                </span>
                <span className="shrink-0 font-mono text-xs">
                  <span className="text-emerald-300">+{file.additions}</span>
                  <span className="mx-1 text-slate-600">/</span>
                  <span className="text-rose-300">-{file.deletions}</span>
                </span>
              </div>
              <pre className="m-0 min-w-full overflow-x-auto p-0 text-xs leading-5">
                {visibleLines.map((line, index) => (
                  <code
                    key={`${file.path}-${index}`}
                    className={`block border-l-2 px-3 font-mono ${lineClassName(line)}`}
                  >
                    {line.text || ' '}
                  </code>
                ))}
                {hiddenCount > 0 && (
                  <code className="block border-l-2 border-slate-800 px-3 font-mono text-slate-500">
                    {hiddenCount} more lines
                  </code>
                )}
              </pre>
            </section>
          );
        })}
      </div>
    </div>
  );
};
