import Prism from 'prismjs';
// Import Prism languages as needed
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-typescript';
import React, { useEffect, useMemo, useRef } from 'react';

import { logger } from '@/lib/logger';
import { renderMarkdownToSafeHtml } from '@/lib/safe-markdown';

interface ChunkedMarkdownProps {
  content: string;
}

/**
 * ChunkedMarkdown component with memoization for performance
 * - React.memo prevents re-renders when content hasn't changed
 * - useMemo caches markdown parsing results
 * - Prism syntax highlighting applied on demand
 */
const ChunkedMarkdown: React.FC<ChunkedMarkdownProps> = React.memo(({ content }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const renderedHtml = useMemo(() => {
    try {
      return renderMarkdownToSafeHtml(content);
    } catch (error) {
      logger.warn('Failed to render markdown content', { error });
      return '';
    }
  }, [content]);

  useEffect(() => {
    if (containerRef.current) {
      Prism.highlightAllUnder(containerRef.current);
    }
  }, [renderedHtml]);

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
