import React, { useEffect, useState } from 'react';
import { buildToolUsageViewItems } from '@taskforceai/presenters/tool-usage/view-model';

import { logger } from '../../lib/logger';
import { CodePanel } from '../tool-usage/CodePanel';
import { DiffPreview } from '../tool-usage/DiffPreview';
import { SearchChips } from '../tool-usage/SearchChips';
import { isCodeExecutionEvent } from '../tool-usage/parsers';
import { type PrismLike, highlightCode, loadPrism } from '../tool-usage/prism';
import type { ToolUsageListProps } from '../tool-usage/types';

const toolStatusClass = (label: string): string => {
  const normalized = label.trim().toLowerCase();
  if (normalized === 'running') {
    return 'running';
  }
  if (normalized === 'success') {
    return 'success';
  }
  return 'failure';
};

type ToolUsageViewItem = ReturnType<typeof buildToolUsageViewItems>[number];

const ToolUsageSummary = ({
  item,
  codeExecution,
  searchEvent,
  isExpanded,
  detailsId,
  onToggle,
}: {
  item: ToolUsageViewItem;
  codeExecution: boolean;
  searchEvent: boolean;
  isExpanded: boolean;
  detailsId: string;
  onToggle: () => void;
}) => (
  <div className={`tool-usage__summary ${searchEvent ? 'tool-usage__summary--search' : ''}`}>
    {searchEvent ? (
      <>
        <span className="tool-usage__search-icon" aria-hidden="true">
          🔍
        </span>
        <span className="tool-usage__tool">{item.title}</span>
      </>
    ) : (
      <span className="tool-usage__tool">{item.title}</span>
    )}
    <span
      className={`tool-usage__status tool-usage__status--${toolStatusClass(item.status.label)}`}
    >
      {item.status.label}
    </span>
    {item.durationLabel && <span className="tool-usage__duration">{item.durationLabel}</span>}
    {codeExecution && (
      <button
        type="button"
        className="tool-usage__toggle"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
        aria-expanded={isExpanded}
        aria-controls={detailsId}
      >
        {isExpanded ? 'Collapse' : 'Expand'}
      </button>
    )}
  </div>
);

const ToolUsageList: React.FC<ToolUsageListProps> = ({
  events,
  condensed = false,
  searchInteractive = false,
  onShowSources,
}) => {
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [prism, setPrism] = useState<PrismLike | null>(null);
  const [isPrismLoading, setIsPrismLoading] = useState(false);

  const hasCodeEvents = Boolean(events?.some((event) => isCodeExecutionEvent(event)));

  useEffect(() => {
    let mounted = true;
    if (!hasCodeEvents) {
      setPrism(null);
      setIsPrismLoading(false);
      return () => {
        mounted = false;
      };
    }

    setIsPrismLoading(true);
    void loadPrism()
      .then((instance) => {
        if (mounted) {
          setPrism(instance as PrismLike);
          setIsPrismLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setIsPrismLoading(false);
          const normalizedError = error instanceof Error ? error : new Error(String(error));
          logger.warn('Failed to load Prism syntax highlighting', {
            error: import.meta.env.PROD
              ? { name: normalizedError.name, message: normalizedError.message }
              : normalizedError,
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, [hasCodeEvents]);

  if (!events || events.length === 0) {
    return null;
  }

  const items = buildToolUsageViewItems(condensed ? events.slice(-3) : events);
  const handleToggle = (key: string) => {
    setExpandedItems((previous) => ({
      ...previous,
      [key]: !previous[key],
    }));
  };

  return (
    <div className="tool-usage" role="region" aria-label="Tool usage log">
      <div className="tool-usage__header">Tools</div>
      <ul className="tool-usage__list">
        {items.map((item) => {
          const { event } = item;
          const eventKey = item.key;
          const codeExecution = item.isCode;
          const searchEvent = item.isSearch;
          const isExpanded = Boolean(codeExecution && expandedItems[eventKey]);
          const detailsId = `${eventKey}-details`;
          const codeArgs = codeExecution ? item.codeArgs : {};
          const preview = codeExecution ? item.codePreview : {};
          const codeHighlight = codeExecution ? highlightCode(codeArgs, prism) : null;
          const hasDiffPreview = Boolean(item.diffPreview);
          const searchLinks = item.searchPreview.links;
          const searchSources = item.searchPreview.sources;
          const seeAllCount =
            item.searchPreview.totalResults > Math.min(searchLinks.length, 4)
              ? item.searchPreview.totalResults
              : null;

          return (
            <li
              key={eventKey}
              className={`tool-usage__item${
                codeExecution ? ' tool-usage__item--collapsible' : ''
              }${searchEvent ? ' tool-usage__item--search' : ''}`}
            >
              <ToolUsageSummary
                item={item}
                codeExecution={codeExecution}
                searchEvent={searchEvent}
                isExpanded={isExpanded}
                detailsId={detailsId}
                onToggle={() => handleToggle(eventKey)}
              />

              {searchEvent && (
                <SearchChips
                  eventKey={eventKey}
                  links={searchLinks}
                  sources={searchSources}
                  seeAllCount={seeAllCount}
                  interactive={searchInteractive}
                  {...(onShowSources ? { onShowSources } : {})}
                />
              )}

              <div className="tool-usage__details">
                <span className="tool-usage__agent">{event.agentLabel}</span>
                {!searchEvent && event.resultPreview && (
                  <span className="tool-usage__preview">{event.resultPreview}</span>
                )}
                {event.error && <span className="tool-usage__error">{event.error}</span>}
              </div>

              {codeExecution && isExpanded && (
                <>
                  {isPrismLoading && (
                    <div className="tool-usage__loading" role="status" aria-live="polite">
                      Loading syntax highlighting...
                    </div>
                  )}
                  <CodePanel
                    detailsId={detailsId}
                    args={codeArgs}
                    preview={preview}
                    highlight={codeHighlight}
                  />
                </>
              )}
              {hasDiffPreview && item.diffPreview && (
                <DiffPreview diff={item.diffPreview} maxLinesPerFile={condensed ? 24 : 80} />
              )}
            </li>
          );
        })}
      </ul>
      {condensed && events.length > items.length && (
        <div className="tool-usage__more">+{events.length - items.length} more tool call(s)</div>
      )}
    </div>
  );
};

export default ToolUsageList;
