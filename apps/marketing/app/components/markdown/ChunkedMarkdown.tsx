import React, { useMemo } from 'react';

import { logger } from '@/lib/logger';
import { renderMarkdownToSafeHtml } from '@/lib/safe-markdown';

interface ChunkedMarkdownProps {
  content: string;
}

/**
 * ChunkedMarkdown component with memoization for performance
 * - React.memo prevents re-renders when content hasn't changed
 * - useMemo caches markdown parsing results
 */
const ChunkedMarkdown: React.FC<ChunkedMarkdownProps> = React.memo(({ content }) => {
  const renderedHtml = useMemo(() => {
    try {
      return renderMarkdownToSafeHtml(content);
    } catch (error) {
      logger.warn('Failed to render markdown content', { error });
      return '';
    }
  }, [content]);

  return <div className="markdown-content" dangerouslySetInnerHTML={{ __html: renderedHtml }} />;
});

ChunkedMarkdown.displayName = 'ChunkedMarkdown';

export default ChunkedMarkdown;
