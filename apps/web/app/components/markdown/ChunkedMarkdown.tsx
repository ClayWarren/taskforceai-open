'use client';

import { FEATURE_FLAGS, useFeatureFlag } from '@taskforceai/feature-flags';
import { containsLatexMath } from '@taskforceai/shared/utils/math';
import React, { useEffect, useMemo, useRef, useState } from 'react';

interface ChunkedMarkdownProps {
  content: string;
}

type RenderedMarkdown = {
  content: string;
  html: string;
};

let markdownEngineLoader: Promise<typeof import('./markdown-engine')> | null = null;

const loadMarkdownEngine = () => {
  markdownEngineLoader ??= import('./markdown-engine');
  return markdownEngineLoader;
};

const shouldHighlightCode = (content: string, html: string): boolean =>
  content.includes('```') || html.includes('<pre') || html.includes('<code');

/**
 * ChunkedMarkdown component with memoization for performance
 * - React.memo prevents re-renders when content hasn't changed
 * - useMemo caches markdown parsing results
 * - Prism syntax highlighting applied on demand
 */
const ChunkedMarkdown: React.FC<ChunkedMarkdownProps> = React.memo(({ content }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingRenderContentRef = useRef(content);
  const renderDelayTimerRef = useRef<number | null>(null);
  const [renderContent, setRenderContent] = useState(content);
  const [renderedMarkdown, setRenderedMarkdown] = useState<RenderedMarkdown | null>(null);
  const isLatexRenderingEnabled = useFeatureFlag(FEATURE_FLAGS.ENABLE_LATEX_RENDERING_WEB);

  const clearRenderDelayTimer = () => {
    if (renderDelayTimerRef.current === null) {
      return;
    }
    window.clearTimeout(renderDelayTimerRef.current);
    renderDelayTimerRef.current = null;
  };

  useEffect(() => () => clearRenderDelayTimer(), []);

  useEffect(() => {
    if (content === renderContent) {
      pendingRenderContentRef.current = content;
      return;
    }

    const isAppendUpdate = renderContent.length > 0 && content.startsWith(renderContent);
    if (!isAppendUpdate) {
      pendingRenderContentRef.current = content;
      clearRenderDelayTimer();
      setRenderContent(content);
      return;
    }

    pendingRenderContentRef.current = content;
    if (renderDelayTimerRef.current !== null) {
      return;
    }

    renderDelayTimerRef.current = window.setTimeout(() => {
      renderDelayTimerRef.current = null;
      setRenderContent(pendingRenderContentRef.current);
    }, 75);
  }, [content, renderContent]);

  useEffect(() => {
    let cancelled = false;

    void loadMarkdownEngine().then((engine) => {
      const html = engine.renderMarkdown(renderContent);
      if (!cancelled) {
        setRenderedMarkdown({ content: renderContent, html });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [renderContent]);

  const renderedHtml = renderedMarkdown?.content === renderContent ? renderedMarkdown.html : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !renderedHtml) {
      return;
    }

    if (isLatexRenderingEnabled && containsLatexMath(renderContent)) {
      void import('./latex-renderer').then((module) => {
        module.renderLatex(container);
      });
    }

    if (shouldHighlightCode(renderContent, renderedHtml)) {
      void import('./prism-highlighter').then((module) => {
        module.highlightMarkdownCode(container);
      });
    }
  }, [isLatexRenderingEnabled, renderContent, renderedHtml]);

  const fallbackContent = useMemo(() => <>{renderContent}</>, [renderContent]);

  if (!renderedHtml) {
    return (
      <div ref={containerRef} className="markdown-content">
        {fallbackContent}
      </div>
    );
  }

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
