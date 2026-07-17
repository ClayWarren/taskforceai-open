'use client';

import { extractDomain } from '@taskforceai/client-core/utils/source-extraction';
import { FileText, Globe2, Plus } from 'lucide-react';
import React, { useState } from 'react';

import { safeExternalHref } from '../../lib/safe-url';
import type { SourceReference } from '../../lib/types';
import {
  pinnedSummaryFileKey,
  type PinnedSummaryData,
  type PinnedSummaryFile,
} from './pinned-summary-data';

export function PinnedSummaryPanel({ children }: { children: React.ReactNode }) {
  return (
    <aside
      id="pinned-summary-panel"
      aria-label="Pinned summary"
      className="fixed top-20 right-5 z-[210] hidden max-h-[calc(100vh-10rem)] w-[22.5rem] overflow-y-auto rounded-[1.75rem] border border-white/[0.06] bg-[#242424]/95 p-4 text-slate-100 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl xl:block"
    >
      {children}
    </aside>
  );
}

export function PinnedSummarySection({
  action,
  children,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section>
      <div className="flex h-7 items-center justify-between px-0.5 text-[15px] font-medium text-slate-400">
        <h2>{title}</h2>
        {action}
      </div>
      <div className="mt-1">{children}</div>
    </section>
  );
}

export const pinnedSummaryRowClass =
  'flex min-h-10 w-full items-center gap-3 rounded-lg px-0.5 text-left text-[15px] text-slate-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70';

const SourceMark = () => (
  <span
    aria-hidden="true"
    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-slate-300"
  >
    <Globe2 aria-hidden="true" size={13} strokeWidth={1.8} />
  </span>
);

export function PinnedSummarySources({ sources }: { sources: SourceReference[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleSources = expanded ? sources : sources.slice(0, 5);

  if (sources.length === 0) return null;

  return (
    <>
      <div className="my-3 h-px bg-white/10" />
      <PinnedSummarySection title="Sources">
        <div className="space-y-0.5">
          {visibleSources.map((source) => {
            const href = safeExternalHref(source.url);
            const domain = extractDomain(source.url);
            const content = (
              <>
                <SourceMark />
                <span className="min-w-0 truncate">{domain}</span>
              </>
            );
            return href ? (
              <a
                key={source.url}
                className={pinnedSummaryRowClass}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={source.title || source.url}
              >
                {content}
              </a>
            ) : (
              <div key={source.url} className={pinnedSummaryRowClass}>
                {content}
              </div>
            );
          })}
          {sources.length > 5 ? (
            <button
              type="button"
              className={`${pinnedSummaryRowClass} text-slate-500 hover:text-slate-300`}
              onClick={() => setExpanded((value) => !value)}
            >
              <span className="flex h-5 w-5 items-center justify-center">
                <Plus aria-hidden="true" size={14} />
              </span>
              {expanded ? 'Show less' : 'View all'}
            </button>
          ) : null}
        </div>
      </PinnedSummarySection>
    </>
  );
}

const OutputRow = ({ file }: { file: PinnedSummaryFile }) => {
  const externalHref = safeExternalHref(file.downloadUrl);
  const href = file.artifactId ? `/artifacts/${encodeURIComponent(file.artifactId)}` : externalHref;
  const opensExternally = !file.artifactId && Boolean(externalHref);
  const content = (
    <>
      <FileText aria-hidden="true" className="shrink-0 text-slate-400" size={18} />
      <span className="min-w-0 truncate">{file.filename}</span>
    </>
  );

  return href ? (
    <a
      className={pinnedSummaryRowClass}
      href={href}
      {...(opensExternally ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {content}
    </a>
  ) : (
    <div className={pinnedSummaryRowClass}>{content}</div>
  );
};

export function WorkPinnedSummary({
  data,
  onCreateOutput,
}: {
  data: PinnedSummaryData;
  onCreateOutput: () => void;
}) {
  const { files, sources } = data;

  return (
    <PinnedSummaryPanel>
      <PinnedSummarySection title="Outputs">
        {files.length > 0 ? (
          <div className="space-y-0.5">
            {files.slice(0, 4).map((file) => (
              <OutputRow key={pinnedSummaryFileKey(file)} file={file} />
            ))}
          </div>
        ) : (
          <button type="button" className={pinnedSummaryRowClass} onClick={onCreateOutput}>
            <Plus aria-hidden="true" className="text-slate-400" size={18} />
            Create a file or site
          </button>
        )}
      </PinnedSummarySection>
      <PinnedSummarySources sources={sources} />
    </PinnedSummaryPanel>
  );
}
