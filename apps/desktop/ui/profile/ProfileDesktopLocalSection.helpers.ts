import { createId } from '@taskforceai/system-runtime/id';

import type {
  AppServerEnvironmentStatus,
  DesktopBrowserAnnotation,
  DesktopBrowserDiagnostics,
  DesktopBrowserSelection,
  DesktopBrowserStatus,
} from '../platform/app-server';

export const PET_MOODS = ['focus', 'idle', 'celebrate', 'alert'] as const;
export type SshProbeStatus = 'idle' | 'probing' | 'ready' | 'error';
export type SshConnectStatus = 'idle' | 'connecting' | 'connected' | 'error';
export type ScreenMemoryActionStatus = 'idle' | 'saving' | 'capturing' | 'error';
export type AppshotActionStatus = 'idle' | 'capturing' | 'attaching' | 'ready' | 'error';
export type LocalEnvironmentActionStatus = 'idle' | 'saving' | 'running' | 'ready' | 'error';
export type WorktreeActionStatus =
  | 'idle'
  | 'loading'
  | 'creating'
  | 'enabling'
  | 'resetting'
  | 'removing'
  | 'ready'
  | 'error';
export type BrowserPreviewActionStatus =
  | 'idle'
  | 'opening'
  | 'syncing'
  | 'selectingPoint'
  | 'selectingArea'
  | 'inspecting'
  | 'annotating'
  | 'capturingScreenshot'
  | 'collectingDiagnostics'
  | 'clearingDiagnostics'
  | 'openingDevtools'
  | 'closingDevtools'
  | 'goingBack'
  | 'goingForward'
  | 'reloading'
  | 'closing'
  | 'error';
export type BrowserReviewSummaryStatus = 'idle' | 'copied' | 'ready' | 'prompted' | 'error';
export type BrowserPreviewCommentAnnotation = {
  kind: 'point' | 'area';
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
};
export type BrowserPreviewComment = {
  id: string;
  url: string;
  text: string;
  target?: string | null;
  annotation?: BrowserPreviewCommentAnnotation | null;
  screenshotPath?: string | null;
  createdAt: number;
};
export type SavedRemoteEnvironment = {
  id: string;
  target: string;
  appServerPath?: string | null;
  lastLocalBaseUrl?: string | null;
};

const REMOTE_ENVIRONMENTS_STORAGE_KEY = '@taskforceai:desktop-remote-environments';
const BROWSER_COMMENTS_STORAGE_KEY = '@taskforceai:desktop-browser-comments';
export const MAX_BROWSER_COMMENTS = 100;

export const loadSavedRemoteEnvironments = (): SavedRemoteEnvironment[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(REMOTE_ENVIRONMENTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is SavedRemoteEnvironment =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.target === 'string'
    );
  } catch {
    return [];
  }
};

export const saveRemoteEnvironments = (environments: SavedRemoteEnvironment[]) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(REMOTE_ENVIRONMENTS_STORAGE_KEY, JSON.stringify(environments));
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isBrowserPreviewCommentAnnotation = (
  item: unknown
): item is BrowserPreviewCommentAnnotation => {
  if (!item || typeof item !== 'object') {
    return false;
  }
  const candidate = item as Partial<BrowserPreviewCommentAnnotation>;
  return (
    (candidate.kind === 'point' || candidate.kind === 'area') &&
    isFiniteNumber(candidate.x) &&
    isFiniteNumber(candidate.y) &&
    (candidate.width === undefined ||
      candidate.width === null ||
      isFiniteNumber(candidate.width)) &&
    (candidate.height === undefined ||
      candidate.height === null ||
      isFiniteNumber(candidate.height))
  );
};

const isBrowserPreviewComment = (item: unknown): item is BrowserPreviewComment => {
  if (!item || typeof item !== 'object') {
    return false;
  }

  const candidate = item as Partial<BrowserPreviewComment>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.text === 'string' &&
    typeof candidate.createdAt === 'number' &&
    (candidate.target === undefined ||
      candidate.target === null ||
      typeof candidate.target === 'string') &&
    (candidate.annotation === undefined ||
      candidate.annotation === null ||
      isBrowserPreviewCommentAnnotation(candidate.annotation)) &&
    (candidate.screenshotPath === undefined ||
      candidate.screenshotPath === null ||
      typeof candidate.screenshotPath === 'string')
  );
};

export const loadBrowserComments = (): BrowserPreviewComment[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(BROWSER_COMMENTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isBrowserPreviewComment).slice(0, MAX_BROWSER_COMMENTS);
  } catch {
    return [];
  }
};

export const saveBrowserComments = (comments: BrowserPreviewComment[]) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(
    BROWSER_COMMENTS_STORAGE_KEY,
    JSON.stringify(comments.slice(0, MAX_BROWSER_COMMENTS))
  );
};

export const formatEnvironmentStatus = (status: AppServerEnvironmentStatus | null) => {
  if (!status || status.active === 'local') {
    return 'Local app-server';
  }
  const target = status.target ?? 'Remote';
  if (!status.remoteConnected) {
    return `${target} disconnected`;
  }
  if (status.localPort && status.remotePort) {
    return `${target} tunnel ${status.localPort} -> ${status.remotePort}`;
  }
  return `${target} at ${status.localBaseUrl ?? 'SSH tunnel'}`;
};

export const formatEnvironmentDetail = (status: AppServerEnvironmentStatus | null) => {
  if (!status?.remoteConnected) {
    return null;
  }
  if (status.localBaseUrl && status.remoteBaseUrl) {
    return `${status.localBaseUrl} to ${status.remoteBaseUrl}`;
  }
  return status.localBaseUrl ?? status.remoteBaseUrl ?? null;
};

export const formatScreenMemoryTime = (value?: number | null) => {
  if (!value) {
    return 'No captures yet';
  }
  return new Date(value).toLocaleString();
};

export const browserCommentUrl = (preview: DesktopBrowserStatus | null, typedUrl: string) =>
  (preview?.currentUrl ?? typedUrl).trim();

export const createBrowserCommentId = () => createId('browser-comment');

const roundBrowserCoordinate = (value: number) => Math.round(value * 10) / 10;

export const browserSelectionToCommentAnnotation = (
  selection: DesktopBrowserSelection | null | undefined
): BrowserPreviewCommentAnnotation | null => {
  if (!selection?.rect && !selection?.point) {
    return null;
  }
  if (selection.mode === 'area' && selection.rect) {
    return {
      kind: 'area',
      x: roundBrowserCoordinate(selection.rect.x),
      y: roundBrowserCoordinate(selection.rect.y),
      width: roundBrowserCoordinate(selection.rect.width),
      height: roundBrowserCoordinate(selection.rect.height),
    };
  }
  const point = selection.point ?? {
    x: selection.rect?.x ?? 0,
    y: selection.rect?.y ?? 0,
  };
  return {
    kind: 'point',
    x: roundBrowserCoordinate(point.x),
    y: roundBrowserCoordinate(point.y),
    width: selection.rect ? roundBrowserCoordinate(selection.rect.width) : null,
    height: selection.rect ? roundBrowserCoordinate(selection.rect.height) : null,
  };
};

export const browserSelectionTarget = (selection: DesktopBrowserSelection | null | undefined) => {
  const element = selection?.element;
  return (
    element?.selector ??
    element?.ariaLabel ??
    element?.text ??
    (selection?.mode === 'area' ? 'Selected area' : 'Selected point')
  );
};

export const formatBrowserAnnotation = (annotation?: BrowserPreviewCommentAnnotation | null) => {
  if (!annotation) {
    return null;
  }
  if (annotation.kind === 'area') {
    return `Area: x=${annotation.x}, y=${annotation.y}, w=${annotation.width ?? 0}, h=${annotation.height ?? 0}`;
  }
  return `Point: x=${annotation.x}, y=${annotation.y}`;
};

export const browserDiagnosticsSlowResourceCount = (diagnostics: DesktopBrowserDiagnostics) => {
  const performance = diagnostics.performance as { slowResources?: unknown[] } | null;
  return Array.isArray(performance?.slowResources) ? performance.slowResources.length : 0;
};

export const browserCommentsToAnnotations = (
  comments: BrowserPreviewComment[],
  currentUrl: string
): DesktopBrowserAnnotation[] =>
  comments
    .filter((comment) => comment.url === currentUrl && comment.annotation)
    .map((comment) => ({
      id: comment.id,
      text: comment.text,
      target: comment.target ?? null,
      x: comment.annotation?.x ?? null,
      y: comment.annotation?.y ?? null,
      width: comment.annotation?.width ?? null,
      height: comment.annotation?.height ?? null,
      kind: comment.annotation?.kind ?? null,
    }));

export const formatBrowserReviewSummary = (comments: BrowserPreviewComment[]) => {
  if (comments.length === 0) {
    return '';
  }

  const grouped = new Map<string, BrowserPreviewComment[]>();
  for (const comment of comments) {
    const urlComments = grouped.get(comment.url);
    if (urlComments) {
      urlComments.push(comment);
    } else {
      grouped.set(comment.url, [comment]);
    }
  }

  const lines = ['Browser review notes', ''];
  for (const [url, urlComments] of grouped) {
    lines.push(`URL: ${url}`);
    urlComments.forEach((comment, index) => {
      const target = comment.target?.trim() || 'Page';
      const commentLines = comment.text.trim().split(/\r?\n/);
      lines.push(`${index + 1}. Target: ${target}`);
      const annotation = formatBrowserAnnotation(comment.annotation);
      if (annotation) {
        lines.push(`   Annotation: ${annotation}`);
      }
      if (comment.screenshotPath) {
        lines.push(`   Screenshot: ${comment.screenshotPath}`);
      }
      lines.push(`   Comment: ${commentLines[0] ?? ''}`);
      for (const line of commentLines.slice(1)) {
        lines.push(`            ${line}`);
      }
    });
    lines.push('');
  }

  return lines.join('\n').trimEnd();
};

export const formatBrowserReviewPrompt = (summary: string) =>
  [
    'Address these Browser review notes. Keep the scope limited to the referenced pages and preserve unrelated behavior.',
    '',
    summary,
  ].join('\n');
