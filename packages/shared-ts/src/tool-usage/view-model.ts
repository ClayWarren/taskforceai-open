import type { SourceReference, ToolUsageEvent } from '../types';
import { extractDomain, formatDuration, formatStatus, formatToolName } from '../utils';
import {
  extractCodeExecutionArgs,
  extractSearchArgs,
  isCodeExecutionEvent,
  isSearchEvent,
  parseDiffPreview,
  parseCodeExecutionPreview,
  parseSearchPreview,
  type CodeExecutionArgs,
  type CodeExecutionPreview,
  type DiffPreview,
  type SearchArgs,
  type SearchPreviewResult,
} from './parsers';

export interface ToolUsageSearchPreviewView {
  domains: string[];
  links: SearchPreviewResult[];
  sources: SourceReference[];
  totalResults: number;
}

export interface ToolUsageViewItem {
  event: ToolUsageEvent;
  index: number;
  key: string;
  toolNameLabel: string;
  title: string;
  status: ReturnType<typeof formatStatus>;
  durationLabel: string | null;
  isSearch: boolean;
  isCode: boolean;
  searchArgs: SearchArgs;
  searchPreview: ToolUsageSearchPreviewView;
  codeArgs: CodeExecutionArgs;
  codePreview: CodeExecutionPreview;
  diffPreview: DiffPreview | null;
}

export const buildToolUsageEventKey = (event: ToolUsageEvent, index: number): string =>
  `${event.timestamp ?? index}-${event.toolName}-${index}`;

export const buildToolUsageSearchPreviewView = (
  preview?: string | null,
  eventSources?: readonly SourceReference[]
): ToolUsageSearchPreviewView => {
  const parsed = parseSearchPreview(preview ?? undefined);
  const items =
    eventSources && eventSources.length > 0
      ? eventSources.map((source) => ({
          url: source.url,
          title: source.title,
          snippet: source.snippet,
        }))
      : parsed.results;
  const domains: string[] = [];
  const links: SearchPreviewResult[] = [];
  const sources: SourceReference[] = [];

  for (const item of items) {
    const url = item.url.trim();
    if (!url) {
      continue;
    }

    const link: SearchPreviewResult = { url };
    if (item.title) {
      link.title = item.title;
    }
    if (item.snippet) {
      link.snippet = item.snippet;
    }
    links.push(link);

    const domain = extractDomain(url);
    if (domain && !domains.includes(domain)) {
      domains.push(domain);
    }

    const source: SourceReference = { url };
    const displayTitle = item.title ?? domain ?? url;
    if (displayTitle) {
      source.title = displayTitle;
    }
    if (item.snippet) {
      source.snippet = item.snippet;
    }
    sources.push(source);
  }

  return {
    domains,
    links,
    sources,
    totalResults:
      eventSources && eventSources.length > 0
        ? eventSources.length
        : (parsed.totalResults ?? links.length),
  };
};

export const formatCodeLanguageLabel = (language?: string): string => {
  if (!language) {
    return 'Code';
  }
  const normalized = language.trim().toLowerCase();
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)} code`;
};

export const createToolUsageViewItem = (
  event: ToolUsageEvent,
  index: number
): ToolUsageViewItem => {
  const isSearch = isSearchEvent(event);
  const isCode = isCodeExecutionEvent(event);
  const searchArgs = extractSearchArgs(event.arguments);
  const toolNameLabel = formatToolName(event.toolName);

  return {
    event,
    index,
    key: buildToolUsageEventKey(event, index),
    toolNameLabel,
    title: isSearch
      ? `Searched for "${searchArgs.query ?? 'unknown query'}"`
      : `Called ${toolNameLabel}`,
    status: formatStatus(event),
    durationLabel: formatDuration(event.durationMs),
    isSearch,
    isCode,
    searchArgs,
    searchPreview: buildToolUsageSearchPreviewView(event.resultPreview, event.sources),
    codeArgs: extractCodeExecutionArgs(event.arguments),
    codePreview: parseCodeExecutionPreview(event.resultPreview ?? undefined),
    diffPreview: parseDiffPreview(event.resultPreview, event.arguments),
  };
};

export const buildToolUsageViewItems = (events?: readonly ToolUsageEvent[]): ToolUsageViewItem[] =>
  (events ?? []).map((event, index) => createToolUsageViewItem(event, index));
