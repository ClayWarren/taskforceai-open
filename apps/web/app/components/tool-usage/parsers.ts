import {
  extractCodeExecutionArgs as extractCodeExecutionArgsShared,
  extractSearchArgs as extractSearchArgsShared,
  isCodeExecutionEvent as isCodeExecutionEventShared,
  isSearchEvent as isSearchEventShared,
  parseCodeExecutionPreview as parseCodeExecutionPreviewShared,
  parseSearchPreview as parseSearchPreviewShared,
} from '@taskforceai/presenters/tool-usage/parsers';
import { extractDomain } from '@taskforceai/client-core/utils';

import type { ToolUsageEvent } from '../../lib/types';
import type {
  CodeExecutionArgs,
  CodeExecutionPreview,
  SearchArgs,
  SearchPreview,
  SearchPreviewLink,
} from './types';

export const isCodeExecutionEvent = (event: ToolUsageEvent): boolean =>
  isCodeExecutionEventShared(event);

export const isSearchEvent = (event: ToolUsageEvent): boolean => isSearchEventShared(event);

export const extractCodeExecutionArgs = (event: ToolUsageEvent): CodeExecutionArgs => {
  return extractCodeExecutionArgsShared(event.arguments);
};

export const extractSearchArgs = (event: ToolUsageEvent): SearchArgs => {
  return extractSearchArgsShared(event.arguments);
};

export const parseCodeExecutionPreview = (preview?: string): CodeExecutionPreview => {
  return parseCodeExecutionPreviewShared(preview);
};

export const parseSearchPreview = (preview?: string): SearchPreview => {
  const parsed = parseSearchPreviewShared(preview);
  const domains: string[] = [];
  const links: SearchPreviewLink[] = [];

  for (const item of parsed.results) {
    if (!item.url.trim()) {
      continue;
    }

    const link: SearchPreviewLink = { url: item.url };
    if (item.title) {
      link.title = item.title;
    }
    if (item.snippet) {
      link.snippet = item.snippet;
    }
    links.push(link);

    const domain = extractDomain(item.url);
    if (domain && !domains.includes(domain)) {
      domains.push(domain);
    }
  }

  return {
    domains,
    links,
    totalResults: parsed.totalResults ?? parsed.results.length,
  };
};
