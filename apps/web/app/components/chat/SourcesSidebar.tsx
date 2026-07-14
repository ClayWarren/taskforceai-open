'use client';

import React, { useEffect, useRef } from 'react';

import { logger } from '../../lib/logger';
import type { SourceReference } from '../../lib/types';
import {
  extractDomain,
  sanitizeRenderableSources,
} from '@taskforceai/client-core/utils/source-extraction';

interface SourcesSidebarProps {
  sources: SourceReference[];
  isOpen: boolean;
  onClose: () => void;
}

const SourcesSidebar: React.FC<SourcesSidebarProps> = ({ sources, isOpen, onClose }) => {
  const droppedUrlLogRef = useRef<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  const sanitizedSources = React.useMemo(
    () =>
      sanitizeRenderableSources({
        droppedUrlLog: droppedUrlLogRef.current,
        logger,
        loggerContext: 'SourcesSidebar',
        sources,
      }),
    [sources]
  );

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="sources-sidebar-backdrop" onClick={handleBackdropClick} aria-hidden="true" />
      {/* Sidebar Panel */}
      <div
        ref={panelRef}
        className="sources-sidebar"
        role="complementary"
        aria-label={`Sources (${sanitizedSources.length})`}
      >
        <div className="sources-sidebar__header">
          <div className="sources-sidebar__title">
            <svg
              className="h-4 w-4 text-blue-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            <span>Sources</span>
            <span className="sources-sidebar__count">{sanitizedSources.length}</span>
          </div>
          <button
            type="button"
            className="sources-sidebar__close"
            onClick={onClose}
            aria-label="Close sources panel"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="sources-sidebar__body">
          {sanitizedSources.length > 0 ? (
            <ul className="sources-sidebar__list">
              {sanitizedSources.map((source, index) => {
                const domain = extractDomain(source.safeUrl);
                return (
                  <li key={`${source.safeUrl}-${index}`} className="sources-sidebar__item">
                    <a
                      href={source.safeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sources-sidebar__link"
                    >
                      <div className="sources-sidebar__item-header">
                        <span className="sources-sidebar__domain">{domain}</span>
                        <svg
                          className="h-3 w-3 flex-shrink-0 text-gray-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                      </div>
                      {source.title && source.title !== domain && (
                        <h3 className="sources-sidebar__item-title">{source.title}</h3>
                      )}
                      {source.snippet && (
                        <p className="sources-sidebar__item-snippet">{source.snippet}</p>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="sources-sidebar__empty">No valid sources available.</p>
          )}
        </div>
      </div>
    </>
  );
};

export default SourcesSidebar;
