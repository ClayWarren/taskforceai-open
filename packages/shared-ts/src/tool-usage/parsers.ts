import { z } from 'zod';

import { parseJsonSchema } from '../json/parse';
import { type Result, err, ok } from '../result';

export type ToolUsageEventLike = {
  toolName?: string | null | undefined;
  arguments?: unknown;
  resultPreview?: string | null | undefined;
  error?: string | null | undefined;
  success?: boolean | null | undefined;
  durationMs?: number | null | undefined;
};
export type CodeExecutionArgs = {
  code?: string | undefined;
  language?: string | undefined;
  timeout?: number | undefined;
};
export type SearchArgs = { query?: string | undefined };
export type CodeExecutionPreview = {
  output?: string | undefined;
  errors?: string | undefined;
  raw?: string | undefined;
};
export type SearchPreviewResult = {
  url: string;
  title?: string | undefined;
  snippet?: string | undefined;
};
export type SearchPreview = { results: SearchPreviewResult[]; totalResults?: number | undefined };
export type DiffPreviewLine = {
  kind: 'context' | 'addition' | 'deletion' | 'hunk' | 'meta';
  text: string;
};
export type DiffPreviewFile = {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffPreviewLine[];
};
export type DiffPreview = {
  files: DiffPreviewFile[];
  additions: number;
  deletions: number;
};

const CodeArgs = z.object({
  code: z.string().optional(),
  language: z.string().optional(),
  timeout: z.number().optional(),
});
const SearchArgs = z.object({ query: z.string().optional() });
const CodePreview = z.object({ output: z.string().optional(), errors: z.string().optional() });
const SearchItem = z.object({
  url: z.string(),
  title: z.string().optional(),
  snippet: z.string().optional(),
});
const SearchPrev = z.union([
  z.object({ results: z.array(SearchItem), totalResults: z.number().optional() }),
  z.object({ links: z.array(SearchItem), totalResults: z.number().optional() }),
]);

const sj = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  const p = parseJsonSchema(v, z.unknown());
  return p.ok ? p.value : null;
};
const isToolName = (e: ToolUsageEventLike, n: string): boolean => {
  const name = e.toolName;
  return typeof name === 'string' && name.trim().toLowerCase() === n;
};

export const isCodeExecutionEvent = (e: ToolUsageEventLike) => isToolName(e, 'execute_code');
export const isSearchEvent = (e: ToolUsageEventLike) => isToolName(e, 'search_web');

export const extractCodeExecutionArgs = (a: unknown): CodeExecutionArgs =>
  CodeArgs.catch({}).parse(sj(a));
export const extractSearchArgs = (a: unknown): SearchArgs => SearchArgs.catch({}).parse(sj(a));

export const parseCodeExecutionPreview = (p?: string): CodeExecutionPreview => {
  const v = sj(p);
  const r = CodePreview.safeParse(v);
  if (r.success && (r.data.output !== undefined || r.data.errors !== undefined)) {
    return r.data;
  }
  return { raw: p };
};

export const parseSearchPreview = (p?: string): SearchPreview => {
  const v = sj(p);
  const r = SearchPrev.safeParse(v);
  if (!r.success) return { results: [] };
  if ('results' in r.data) {
    const total = r.data.totalResults ?? r.data.results.length;
    return { results: r.data.results, totalResults: total };
  }
  const total = r.data.totalResults ?? r.data.links.length;
  return { results: r.data.links, totalResults: total };
};

const DIFF_KEYS = ['diff', 'patch', 'unifiedDiff', 'unified_diff'] as const;

const collectDiffText = (value: unknown, depth = 0): string | null => {
  if (depth > 3 || value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const parsed = sj(value);
    if (parsed && parsed !== value) {
      const nested = collectDiffText(parsed, depth + 1);
      if (nested) return nested;
    }
    return looksLikeUnifiedDiff(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = collectDiffText(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  if (typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of DIFF_KEYS) {
    const nested = collectDiffText(record[key], depth + 1);
    if (nested) return nested;
  }
  for (const key of ['metadata', 'arguments', 'args', 'result', 'changes']) {
    const nested = collectDiffText(record[key], depth + 1);
    if (nested) return nested;
  }
  return null;
};

const looksLikeUnifiedDiff = (value: string): boolean => {
  const text = value.trim();
  if (!text) return false;
  return (
    text.includes('\n@@ ') ||
    text.includes('\ndiff --git ') ||
    (text.includes('\n--- ') && text.includes('\n+++ '))
  );
};

const normalizeDiffPath = (line: string): string | null => {
  const raw = line.slice(4).trim();
  if (!raw || raw === '/dev/null') return null;
  return raw.replace(/^"|"$/g, '').replace(/^[ab]\//, '');
};

const classifyDiffLine = (line: string): DiffPreviewLine['kind'] => {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'addition';
  if (line.startsWith('-') && !line.startsWith('---')) return 'deletion';
  if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ')) {
    return 'meta';
  }
  if (line.startsWith('+++ ')) return 'meta';
  return 'context';
};

export const parseDiffPreview = (...sources: unknown[]): DiffPreview | null => {
  const diffText = sources.map((source) => collectDiffText(source)).find(Boolean);
  if (!diffText) return null;

  const files: DiffPreviewFile[] = [];
  let current: DiffPreviewFile | null = null;
  let pendingPath: string | null = null;

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      pendingPath = match?.[2] ?? match?.[1] ?? null;
      current = null;
      continue;
    }

    if (line.startsWith('--- ')) {
      pendingPath = normalizeDiffPath(line) ?? pendingPath;
      continue;
    }

    if (line.startsWith('+++ ')) {
      const nextPath = normalizeDiffPath(line) ?? pendingPath ?? 'changed file';
      current = { path: nextPath, additions: 0, deletions: 0, lines: [] };
      files.push(current);
      pendingPath = null;
      current.lines.push({ kind: 'meta', text: line });
      continue;
    }

    if (!current) {
      continue;
    }

    const kind = classifyDiffLine(line);
    if (kind === 'addition') current.additions += 1;
    if (kind === 'deletion') current.deletions += 1;
    if (line || kind !== 'context') {
      current.lines.push({ kind, text: line });
    }
  }

  if (files.length === 0) return null;
  return {
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
};

export const safeArgsForDisplay = (a: unknown): Result<Record<string, unknown>, 'INVALID_ARGS'> => {
  const v = sj(a);
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  return isRecord(v) ? ok(v) : err('INVALID_ARGS');
};
