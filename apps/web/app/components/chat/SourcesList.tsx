import React, { useMemo, useRef } from 'react';

import { logger } from '../../lib/logger';
import type { SourceReference } from '../../lib/types';
import {
  extractDomain,
  sanitizeRenderableSources,
} from '@taskforceai/shared/utils/source-extraction';

interface SourcesListProps {
  sources: SourceReference[];
}

const MAX_SOURCES = 6;

const SourcesList: React.FC<SourcesListProps> = ({ sources }) => {
  const droppedUrlLogRef = useRef<Set<string>>(new Set());

  const sanitizedSources = useMemo(() => {
    if (!sources || sources.length === 0) {
      return [];
    }
    return sanitizeRenderableSources({
      droppedUrlLog: droppedUrlLogRef.current,
      logger,
      loggerContext: 'SourcesList',
      limit: MAX_SOURCES,
      sources,
    });
  }, [sources]);

  if (!sources || sources.length === 0 || sanitizedSources.length === 0) {
    return null;
  }

  return (
    <div className="message-sources" role="region" aria-label="Sources">
      <div className="message-sources__header">
        <span className="message-sources__indicator" aria-hidden="true"></span>
        <span className="message-sources__title">Sources</span>
      </div>
      <ul className="message-sources__list">
        {sanitizedSources.map((source, index) => {
          const domain = extractDomain(source.safeUrl);
          return (
            <li key={`${source.safeUrl}-${index}`} className="message-source-item">
              <a
                href={source.safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="message-source-item__link"
              >
                <span className="message-source-item__domain">{domain}</span>
                {source.title && source.title !== domain && (
                  <span className="message-source-item__title">{source.title}</span>
                )}
              </a>
              {source.snippet && <p className="message-source-item__snippet">{source.snippet}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default SourcesList;
