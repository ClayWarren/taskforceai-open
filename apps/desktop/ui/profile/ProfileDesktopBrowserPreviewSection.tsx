import type {
  DesktopBrowserDevtoolsStatus,
  DesktopBrowserDiagnostics,
  DesktopBrowserInspection,
  DesktopBrowserScreenshotResult,
  DesktopBrowserStatus,
} from '../platform/app-server-types';
import {
  browserDiagnosticsSlowResourceCount,
  formatBrowserAnnotation,
  type BrowserPreviewActionStatus,
  type BrowserPreviewComment,
  type BrowserPreviewCommentAnnotation,
  type BrowserReviewSummaryStatus,
} from './ProfileDesktopLocalSection.helpers';

export type BrowserPreviewSectionProps = {
  browserUrl: string;
  setBrowserUrl: (value: string) => void;
  browserPreview: DesktopBrowserStatus | null;
  browserPreviewActionStatus: BrowserPreviewActionStatus;
  openBrowserPreview: () => Promise<void>;
  goBackBrowserPreview: () => Promise<void>;
  goForwardBrowserPreview: () => Promise<void>;
  reloadBrowserPreview: () => Promise<void>;
  syncBrowserPreview: () => Promise<void>;
  closeBrowserPreview: () => Promise<void>;
  selectBrowserPreviewAnnotation: (mode: 'point' | 'area') => Promise<void>;
  syncBrowserPreviewAnnotations: () => Promise<void>;
  clearBrowserPreviewAnnotations: () => Promise<void>;
  inspectBrowserPreview: () => Promise<void>;
  collectBrowserPreviewDiagnostics: () => Promise<void>;
  clearBrowserPreviewDiagnostics: () => Promise<void>;
  captureBrowserPreviewScreenshot: () => Promise<void>;
  openBrowserPreviewDevtools: () => Promise<void>;
  closeBrowserPreviewDevtools: () => Promise<void>;
  browserCommentAnnotation: BrowserPreviewCommentAnnotation | null;
  browserScreenshot: DesktopBrowserScreenshotResult | null;
  browserInspection: DesktopBrowserInspection | null;
  browserDiagnostics: DesktopBrowserDiagnostics | null;
  browserDevtools: DesktopBrowserDevtoolsStatus | null;
  browserPreviewError: string | null;
  browserCommentText: string;
  setBrowserCommentText: (value: string) => void;
  browserCommentTarget: string;
  setBrowserCommentTarget: (value: string) => void;
  currentBrowserComments: BrowserPreviewComment[];
  addBrowserComment: () => void;
  clearCurrentBrowserComments: () => void;
  removeBrowserComment: (commentId: string) => void;
  copyBrowserReviewSummary: () => Promise<void>;
  useBrowserReviewSummaryAsPrompt: () => void;
  clearAllBrowserComments: () => void;
  browserCommentsCount: number;
  browserReviewSummaryStatus: BrowserReviewSummaryStatus;
  browserReviewSummaryError: string | null;
  browserReviewSummary: string | null;
};

const previewActionDisabled = (
  preview: DesktopBrowserStatus | null,
  status: BrowserPreviewActionStatus,
  activeStatus: BrowserPreviewActionStatus
): boolean => preview?.open !== true || status === activeStatus;

const previewActionLabel = (
  status: BrowserPreviewActionStatus,
  activeStatus: BrowserPreviewActionStatus,
  activeLabel: string,
  idleLabel: string
): string => (status === activeStatus ? activeLabel : idleLabel);

function BrowserPreviewResultStatus({
  browserCommentAnnotation,
  browserScreenshot,
  browserInspection,
  browserDiagnostics,
  browserDevtools,
  browserPreviewError,
}: Pick<
  BrowserPreviewSectionProps,
  | 'browserCommentAnnotation'
  | 'browserScreenshot'
  | 'browserInspection'
  | 'browserDiagnostics'
  | 'browserDevtools'
  | 'browserPreviewError'
>) {
  return (
    <>
      {browserCommentAnnotation ? (
        <p className="text-xs text-emerald-100">
          Selected {formatBrowserAnnotation(browserCommentAnnotation)}
        </p>
      ) : null}
      {browserScreenshot ? (
        <p className="truncate text-xs text-slate-200/80">
          Preview capture: {browserScreenshot.path}
        </p>
      ) : null}
      {browserInspection ? (
        <p className="text-xs text-slate-200/80">
          Inspected {browserInspection.elements.length} element
          {browserInspection.elements.length === 1 ? '' : 's'} on{' '}
          {browserInspection.title || browserInspection.url}.
        </p>
      ) : null}
      {browserDiagnostics ? (
        <p className="text-xs text-slate-200/80">
          Diagnostics: {browserDiagnostics.logs.length} logs, {browserDiagnostics.network.length}{' '}
          requests, {browserDiagnostics.errors.length} errors,{' '}
          {browserDiagnosticsSlowResourceCount(browserDiagnostics)} slow resources.
        </p>
      ) : null}
      {browserDevtools ? (
        <p className="text-xs text-slate-200/80">{browserDevtools.message}</p>
      ) : null}
      {browserPreviewError ? <p className="text-xs text-red-400">{browserPreviewError}</p> : null}
    </>
  );
}

export function BrowserPreviewSection({
  browserUrl,
  setBrowserUrl,
  browserPreview,
  browserPreviewActionStatus,
  openBrowserPreview,
  goBackBrowserPreview,
  goForwardBrowserPreview,
  reloadBrowserPreview,
  syncBrowserPreview,
  closeBrowserPreview,
  selectBrowserPreviewAnnotation,
  syncBrowserPreviewAnnotations,
  clearBrowserPreviewAnnotations,
  inspectBrowserPreview,
  collectBrowserPreviewDiagnostics,
  clearBrowserPreviewDiagnostics,
  captureBrowserPreviewScreenshot,
  openBrowserPreviewDevtools,
  closeBrowserPreviewDevtools,
  browserCommentAnnotation,
  browserScreenshot,
  browserInspection,
  browserDiagnostics,
  browserDevtools,
  browserPreviewError,
  browserCommentText,
  setBrowserCommentText,
  browserCommentTarget,
  setBrowserCommentTarget,
  currentBrowserComments,
  addBrowserComment,
  clearCurrentBrowserComments,
  removeBrowserComment,
  copyBrowserReviewSummary,
  useBrowserReviewSummaryAsPrompt,
  clearAllBrowserComments,
  browserCommentsCount,
  browserReviewSummaryStatus,
  browserReviewSummaryError,
  browserReviewSummary,
}: BrowserPreviewSectionProps) {
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div>
        <label className="text-sm font-medium" htmlFor="desktop-browser-url">
          Browser preview
        </label>
        <p className="mt-1 text-xs text-slate-200/80">
          {browserPreview?.open
            ? `Open at ${browserPreview.currentUrl ?? 'current page'}`
            : (browserPreview?.message ?? 'Open a local route or public page.')}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="desktop-browser-url"
          className="min-w-0 flex-1 rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-white placeholder:text-slate-300/65"
          placeholder="http://localhost:3000"
          value={browserUrl}
          onChange={(event) => setBrowserUrl(event.currentTarget.value)}
          onInput={(event) => setBrowserUrl(event.currentTarget.value)}
        />
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={
              browserPreviewActionStatus === 'opening' ? true : browserUrl.trim().length === 0
            }
            onClick={() => void openBrowserPreview()}
          >
            {previewActionLabel(browserPreviewActionStatus, 'opening', 'Opening', 'Open preview')}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={previewActionDisabled(
              browserPreview,
              browserPreviewActionStatus,
              'goingBack'
            )}
            onClick={() => void goBackBrowserPreview()}
          >
            Back
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={previewActionDisabled(
              browserPreview,
              browserPreviewActionStatus,
              'goingForward'
            )}
            onClick={() => void goForwardBrowserPreview()}
          >
            Forward
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={previewActionDisabled(
              browserPreview,
              browserPreviewActionStatus,
              'reloading'
            )}
            onClick={() => void reloadBrowserPreview()}
          >
            {previewActionLabel(browserPreviewActionStatus, 'reloading', 'Reloading', 'Reload')}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={previewActionDisabled(browserPreview, browserPreviewActionStatus, 'syncing')}
            onClick={() => void syncBrowserPreview()}
          >
            {previewActionLabel(browserPreviewActionStatus, 'syncing', 'Syncing', 'Sync page')}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={previewActionDisabled(browserPreview, browserPreviewActionStatus, 'closing')}
            onClick={() => void closeBrowserPreview()}
          >
            {previewActionLabel(browserPreviewActionStatus, 'closing', 'Closing', 'Close')}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={previewActionDisabled(
            browserPreview,
            browserPreviewActionStatus,
            'selectingPoint'
          )}
          onClick={() => void selectBrowserPreviewAnnotation('point')}
        >
          {previewActionLabel(
            browserPreviewActionStatus,
            'selectingPoint',
            'Selecting',
            'Select point'
          )}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={previewActionDisabled(
            browserPreview,
            browserPreviewActionStatus,
            'selectingArea'
          )}
          onClick={() => void selectBrowserPreviewAnnotation('area')}
        >
          {previewActionLabel(
            browserPreviewActionStatus,
            'selectingArea',
            'Selecting',
            'Select area'
          )}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={previewActionDisabled(browserPreview, browserPreviewActionStatus, 'annotating')}
          onClick={() => void syncBrowserPreviewAnnotations()}
        >
          {previewActionLabel(
            browserPreviewActionStatus,
            'annotating',
            'Showing',
            'Show annotations'
          )}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={previewActionDisabled(browserPreview, browserPreviewActionStatus, 'annotating')}
          onClick={() => void clearBrowserPreviewAnnotations()}
        >
          Clear overlays
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={previewActionDisabled(browserPreview, browserPreviewActionStatus, 'inspecting')}
          onClick={() => void inspectBrowserPreview()}
        >
          {previewActionLabel(browserPreviewActionStatus, 'inspecting', 'Inspecting', 'Inspect')}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={previewActionDisabled(
            browserPreview,
            browserPreviewActionStatus,
            'collectingDiagnostics'
          )}
          onClick={() => void collectBrowserPreviewDiagnostics()}
        >
          {previewActionLabel(
            browserPreviewActionStatus,
            'collectingDiagnostics',
            'Collecting',
            'Diagnostics'
          )}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={previewActionDisabled(
            browserPreview,
            browserPreviewActionStatus,
            'clearingDiagnostics'
          )}
          onClick={() => void clearBrowserPreviewDiagnostics()}
        >
          Clear diagnostics
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={previewActionDisabled(
            browserPreview,
            browserPreviewActionStatus,
            'capturingScreenshot'
          )}
          onClick={() => void captureBrowserPreviewScreenshot()}
        >
          {previewActionLabel(
            browserPreviewActionStatus,
            'capturingScreenshot',
            'Capturing',
            'Capture preview'
          )}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={previewActionDisabled(
            browserPreview,
            browserPreviewActionStatus,
            'openingDevtools'
          )}
          onClick={() => void openBrowserPreviewDevtools()}
        >
          Open devtools
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={previewActionDisabled(
            browserPreview,
            browserPreviewActionStatus,
            'closingDevtools'
          )}
          onClick={() => void closeBrowserPreviewDevtools()}
        >
          Close devtools
        </button>
      </div>
      <BrowserPreviewResultStatus
        browserCommentAnnotation={browserCommentAnnotation}
        browserScreenshot={browserScreenshot}
        browserInspection={browserInspection}
        browserDiagnostics={browserDiagnostics}
        browserDevtools={browserDevtools}
        browserPreviewError={browserPreviewError}
      />
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="desktop-browser-comment">
          Page comment
        </label>
        <textarea
          id="desktop-browser-comment"
          className="min-h-20 w-full resize-y rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-white placeholder:text-slate-300/65"
          placeholder="Describe the visual issue or change to make on this page."
          value={browserCommentText}
          onChange={(event) => setBrowserCommentText(event.currentTarget.value)}
          onInput={(event) => setBrowserCommentText(event.currentTarget.value)}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            aria-label="Comment target"
            className="min-w-0 flex-1 rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-white placeholder:text-slate-300/65"
            placeholder="Optional element, area, or selector"
            value={browserCommentTarget}
            onChange={(event) => setBrowserCommentTarget(event.currentTarget.value)}
            onInput={(event) => setBrowserCommentTarget(event.currentTarget.value)}
          />
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={browserCommentText.trim().length === 0}
              onClick={addBrowserComment}
            >
              Add comment
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={currentBrowserComments.length === 0}
              onClick={clearCurrentBrowserComments}
            >
              Clear
            </button>
          </div>
        </div>
        {currentBrowserComments.length > 0 ? (
          <ul className="space-y-2 text-xs text-slate-200/80">
            {currentBrowserComments.map((comment) => (
              <li key={comment.id} className="border-t border-border pt-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="whitespace-pre-wrap text-slate-100">{comment.text}</p>
                    <p className="mt-1 truncate">
                      {comment.target ? `${comment.target} - ` : ''}
                      {new Date(comment.createdAt).toLocaleString()}
                    </p>
                    {formatBrowserAnnotation(comment.annotation) ? (
                      <p className="mt-1 truncate">{formatBrowserAnnotation(comment.annotation)}</p>
                    ) : null}
                    {comment.screenshotPath ? (
                      <p className="mt-1 truncate">Capture: {comment.screenshotPath}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white"
                    onClick={() => removeBrowserComment(comment.id)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white"
              onClick={() => void copyBrowserReviewSummary()}
            >
              Copy summary
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white"
              onClick={useBrowserReviewSummaryAsPrompt}
            >
              Use as prompt
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={browserCommentsCount === 0}
              onClick={clearAllBrowserComments}
            >
              Clear all
            </button>
          </div>
          {browserReviewSummaryStatus === 'copied' ? (
            <p className="text-xs text-emerald-100">Copied review summary.</p>
          ) : browserReviewSummaryStatus === 'prompted' ? (
            <p className="text-xs text-emerald-100">Added review summary to prompt.</p>
          ) : browserReviewSummaryStatus === 'ready' ? (
            <p className="text-xs text-slate-200/80">Review summary is ready.</p>
          ) : browserReviewSummaryStatus === 'error' && browserReviewSummaryError ? (
            <p className="text-xs text-red-400">{browserReviewSummaryError}</p>
          ) : browserCommentsCount > 0 ? (
            <p className="text-xs text-slate-200/80">
              {browserCommentsCount} saved review{' '}
              {browserCommentsCount === 1 ? 'comment' : 'comments'}.
            </p>
          ) : null}
        </div>
        {browserReviewSummary ? (
          <textarea
            readOnly
            aria-label="Browser review summary"
            className="min-h-28 w-full resize-y rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-slate-200/80"
            value={browserReviewSummary}
            onFocus={(event) => event.currentTarget.select()}
          />
        ) : null}
      </div>
    </div>
  );
}
