import type { SourceReference } from '../types';

export const sanitizeUrl = (rawUrl: string): string => {
  return rawUrl.replace(/[),.;!?]+\s*$/g, '');
};

export const sanitizeHttpUrl = (rawUrl: string): string | null => {
  const sanitized = sanitizeUrl(rawUrl);
  try {
    const parsed = new URL(sanitized);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? sanitized : null;
  } catch {
    return null;
  }
};

export const extractDomain = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export const deriveTitleFromLine = (line: string, url: string): string => {
  const withoutUrl = line
    .replace(url, '')
    .trim()
    .replace(/^[-*\d.\s:]+/, '');
  if (withoutUrl.length > 0) {
    return withoutUrl.length > 80 ? `${withoutUrl.slice(0, 77)}…` : withoutUrl;
  }
  return extractDomain(url);
};

export const extractSourcesFromText = (text?: string | null): SourceReference[] => {
  if (!text) {
    return [];
  }
  if (!text.includes('://') && !text.includes('www.')) {
    return [];
  }

  const markdownRegex = /\[([^\]]+)\]\((?<url>(?:https?|ftp):\/\/[^)]+|www\.[^)]+)\)/gi;
  const urlRegex = /https?:\/\/\S+/gi;

  const matches: SourceReference[] = [];
  const seen = new Set<string>();

  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownRegex.exec(text)) !== null) {
    const rawUrl = markdownMatch[2];
    if (!rawUrl) {
      continue;
    }
    const url = sanitizeUrl(rawUrl);
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    matches.push({
      url,
      title: markdownMatch[1] ? markdownMatch[1].trim() : extractDomain(url),
    });
  }

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line || !line.trim()) {
      continue;
    }
    const trimmedLine = line.trim();
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRegex.exec(trimmedLine)) !== null) {
      const url = sanitizeUrl(urlMatch[0]);
      if (seen.has(url)) {
        const existing = matches.find((source) => source.url === url);
        if (existing && (!existing.snippet || existing.snippet === existing.url)) {
          existing.snippet = trimmedLine;
        }
        continue;
      }
      seen.add(url);
      matches.push({
        url,
        title: deriveTitleFromLine(trimmedLine, url) || extractDomain(url),
        snippet: trimmedLine,
      });
    }
  }

  return matches;
};

export const mergeSources = (
  current: SourceReference[],
  next: SourceReference[]
): SourceReference[] => {
  if (next.length === 0) {
    return current;
  }
  const map = new Map<string, SourceReference>();
  for (const source of current) {
    map.set(source.url, { ...source });
  }
  for (const source of next) {
    const existing = map.get(source.url);
    if (!existing) {
      map.set(source.url, { ...source });
      continue;
    }
    const merged: SourceReference = {
      url: existing.url,
    };
    const title = existing.title || source.title;
    if (title) merged.title = title;
    const snippet = existing.snippet || source.snippet;
    if (snippet) merged.snippet = snippet;
    map.set(source.url, merged);
  }
  return Array.from(map.values());
};

export interface RenderableSource extends SourceReference {
  safeUrl: string;
}

export interface SanitizeRenderableSourcesOptions {
  droppedUrlLog?: Set<string>;
  logger?: {
    warn: (message: string, context?: Record<string, unknown>) => void;
  };
  loggerContext?: string;
  limit?: number;
  sources: SourceReference[];
}

export const sanitizeRenderableSources = ({
  droppedUrlLog,
  logger,
  loggerContext = 'Sources',
  limit,
  sources,
}: SanitizeRenderableSourcesOptions): RenderableSource[] => {
  const sanitized: RenderableSource[] = [];
  const candidateSources = limit === undefined ? sources : sources.slice(0, limit);

  for (const source of candidateSources) {
    const safeUrl = sanitizeHttpUrl(source.url);
    if (!safeUrl) {
      const droppedKey = `${source.url}|${source.title ?? ''}`;
      if (!droppedUrlLog?.has(droppedKey)) {
        droppedUrlLog?.add(droppedKey);
        logger?.warn(`Dropped source with unsafe URL in ${loggerContext}`, {
          url: source.url,
          title: source.title ?? null,
        });
      }
      continue;
    }
    sanitized.push({ ...source, safeUrl });
  }

  return sanitized;
};
