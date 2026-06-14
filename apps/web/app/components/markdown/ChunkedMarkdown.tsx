'use client';

import { FEATURE_FLAGS, useFeatureFlag } from '@taskforceai/feature-flags';
import { LATEX_RENDER_DELIMITERS, containsLatexMath } from '@taskforceai/shared/utils/math';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import renderMathInElement from 'katex/contrib/auto-render';
import { marked } from 'marked';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.min.css';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';
import React, { useEffect, useMemo, useRef, useState } from 'react';

interface ChunkedMarkdownProps {
  content: string;
}

const markdownRenderer = new marked.Renderer();
const renderTable = markdownRenderer.table.bind(markdownRenderer);

markdownRenderer.table = (token) =>
  `<div class="markdown-table-scroll">${renderTable(token)}</div>`;

if (typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/**
 * ChunkedMarkdown component with memoization for performance
 * - React.memo prevents re-renders when content hasn't changed
 * - useMemo caches markdown parsing results
 * - Prism syntax highlighting applied on demand
 */
const ChunkedMarkdown: React.FC<ChunkedMarkdownProps> = React.memo(({ content }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderContent, setRenderContent] = useState(content);
  const isLatexRenderingEnabled = useFeatureFlag(FEATURE_FLAGS.ENABLE_LATEX_RENDERING_WEB);

  useEffect(() => {
    if (content === renderContent) {
      return;
    }

    const delayMs = content.startsWith(renderContent) ? 75 : 0;
    const timer = window.setTimeout(() => {
      setRenderContent(content);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [content, renderContent]);

  const renderedHtml = useMemo(() => {
    const rendered = marked.parse(renderContent, {
      async: false,
      gfm: true,
      renderer: markdownRenderer,
    });
    // Type assertion justified: marked.parse with async: false returns string synchronously,
    // but TypeScript may not narrow the union type correctly in all versions
    const renderedString = typeof rendered === 'string' ? rendered : String(rendered);
    const sanitized = DOMPurify.sanitize(renderedString, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ['video', 'source'],
      ADD_ATTR: ['controls', 'playsinline', 'poster', 'preload', 'rel', 'src', 'target', 'type'],
    });
    return sanitized;
  }, [renderContent]);

  useEffect(() => {
    if (containerRef.current) {
      if (isLatexRenderingEnabled && containsLatexMath(renderContent)) {
        renderMathInElement(containerRef.current, {
          delimiters: [...LATEX_RENDER_DELIMITERS],
          ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
          throwOnError: false,
        });
      }

      Prism.highlightAllUnder(containerRef.current);
    }
  }, [isLatexRenderingEnabled, renderContent, renderedHtml]);

  return (
    <div
      ref={containerRef}
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
});

ChunkedMarkdown.displayName = 'ChunkedMarkdown';

export default ChunkedMarkdown;
