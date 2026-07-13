'use client';

import React from 'react';

import type { SourceReference } from '../../lib/types';
import { extractDomain } from '@taskforceai/client-core/utils';
import { sanitizeHttpUrl } from '@taskforceai/client-core/utils/source-extraction';
import type { SearchPreviewLink } from './types';

interface SearchChipsProps {
  eventKey: string;
  links: SearchPreviewLink[];
  sources: SourceReference[];
  seeAllCount: number | null;
  interactive: boolean;
  onShowSources?: (sources: SourceReference[]) => void;
}

export const SearchChips: React.FC<SearchChipsProps> = ({
  eventKey,
  links,
  sources,
  seeAllCount,
  interactive,
  onShowSources,
}) => {
  if (links.length === 0) {
    return null;
  }

  const chipLinks = links.slice(0, 4);

  return (
    <div className="tool-usage__search-domains">
      {chipLinks.map((link, chipIndex) => {
        const domain = extractDomain(link.url) ?? link.url;
        if (!domain) {
          return null;
        }
        const chipKey = `${eventKey}-${domain}-${chipIndex}`;
        if (!interactive) {
          return (
            <span
              key={chipKey}
              className="tool-usage__search-chip tool-usage__search-chip--disabled"
            >
              {domain}
            </span>
          );
        }
        const safeUrl = sanitizeHttpUrl(link.url);
        if (!safeUrl) {
          return (
            <span
              key={chipKey}
              className="tool-usage__search-chip tool-usage__search-chip--disabled"
            >
              {domain}
            </span>
          );
        }
        return (
          <a
            key={chipKey}
            className="tool-usage__search-chip tool-usage__search-chip--link"
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {domain}
          </a>
        );
      })}
      {seeAllCount &&
        (interactive && sources.length > 0 && onShowSources ? (
          <button
            type="button"
            className="tool-usage__search-chip tool-usage__search-chip--cta"
            onClick={() => onShowSources(sources)}
          >
            See all ({seeAllCount})
          </button>
        ) : (
          <span className="tool-usage__search-chip tool-usage__search-chip--disabled">
            See all ({seeAllCount})
          </span>
        ))}
    </div>
  );
};
