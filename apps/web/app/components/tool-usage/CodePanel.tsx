'use client';

import React from 'react';

import { formatLanguageLabel, sanitizePrismHtml } from './prism';
import type { CodeExecutionArgs, CodeExecutionPreview } from './types';

interface CodePanelProps {
  detailsId: string;
  args: CodeExecutionArgs;
  preview: CodeExecutionPreview;
  highlight: { html: string | null; languageClass: string } | null;
}

export const CodePanel: React.FC<CodePanelProps> = ({ detailsId, args, preview, highlight }) => {
  const resolvedOutput = preview.output ?? preview.raw;

  return (
    <div className="tool-usage__code-panel" id={detailsId}>
      {args.code && (
        <div className="tool-usage__code-block">
          <div className="tool-usage__section-heading">{formatLanguageLabel(args.language)}</div>
          <pre className={`tool-usage__pre ${highlight?.languageClass ?? ''}`}>
            {highlight?.html ? (
              <code
                className={highlight.languageClass}
                dangerouslySetInnerHTML={{ __html: sanitizePrismHtml(highlight.html) }}
              ></code>
            ) : (
              <code>{args.code}</code>
            )}
          </pre>
        </div>
      )}
      {(resolvedOutput || preview.errors) && (
        <div className="tool-usage__log-block">
          {resolvedOutput && (
            <>
              <div className="tool-usage__section-heading">Output</div>
              <pre className="tool-usage__pre">{resolvedOutput}</pre>
            </>
          )}
          {preview.errors && (
            <>
              <div className="tool-usage__section-heading">Errors</div>
              <pre className="tool-usage__pre">{preview.errors}</pre>
            </>
          )}
        </div>
      )}
      {args.timeout && (
        <div className="tool-usage__meta">
          Timeout: {(args.timeout / 1000).toFixed(1).replace(/\.0$/, '')}s
        </div>
      )}
    </div>
  );
};
