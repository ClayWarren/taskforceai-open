'use client';

import React from 'react';

import { formatLanguageLabel } from './prism';
import type { CodeExecutionArgs, CodeExecutionPreview } from './types';

interface CodePanelProps {
  detailsId: string;
  args: CodeExecutionArgs;
  preview: CodeExecutionPreview;
  highlight: { html: string | null; languageClass: string } | null;
}

const sanitizePrismHtml = (html: string): string => {
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
    return html.replace(/<[^>]*>/g, '');
  }

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const container = parsed.body;

  for (const element of container.querySelectorAll('*')) {
    if (element.tagName.toLowerCase() !== 'span') {
      element.replaceWith(document.createTextNode(element.textContent ?? ''));
      continue;
    }

    const safeClasses = (element.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter((className) => /^[A-Za-z0-9_-]+$/.test(className));

    while (element.attributes.length > 0) {
      const attribute = element.attributes.item(0);
      if (!attribute) {
        break;
      }
      element.removeAttribute(attribute.name);
    }

    if (safeClasses.length > 0) {
      element.setAttribute('class', safeClasses.join(' '));
    }
  }

  return container.innerHTML;
};

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
