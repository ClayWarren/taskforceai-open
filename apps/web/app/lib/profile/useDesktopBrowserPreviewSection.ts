import { useCallback, useState } from 'react';

import {
  captureDesktopBrowserPreviewScreenshot,
  clearDesktopBrowserPreviewDiagnostics,
  closeDesktopBrowserPreview,
  closeDesktopBrowserPreviewDevtools,
  getDesktopBrowserPreviewDiagnostics,
  getDesktopBrowserPreviewDevtoolsStatus,
  getDesktopBrowserPreviewStatus,
  goBackDesktopBrowserPreview,
  goForwardDesktopBrowserPreview,
  inspectDesktopBrowserPreview,
  openDesktopBrowserPreview,
  openDesktopBrowserPreviewDevtools,
  reloadDesktopBrowserPreview,
  runDesktopBrowserPreviewAction,
  setDesktopBrowserPreviewAnnotations,
  type DesktopBrowserActionResult,
  type DesktopBrowserDevtoolsStatus,
  type DesktopBrowserDiagnostics,
  type DesktopBrowserInspection,
  type DesktopBrowserScreenshotResult,
  type DesktopBrowserStatus,
} from '../platform/desktop/app-server';
import {
  PROMPT_DRAFT_CAPTURE_EVENT,
  writeCapturedPromptDraft,
} from '../prompt/hydration-draft-capture';

import type { BrowserPreviewSectionProps } from './ProfileDesktopBrowserPreviewSection';
import {
  MAX_BROWSER_COMMENTS,
  browserCommentUrl,
  browserCommentsToAnnotations,
  browserSelectionTarget,
  browserSelectionToCommentAnnotation,
  createBrowserCommentId,
  formatBrowserReviewPrompt,
  formatBrowserReviewSummary,
  loadBrowserComments,
  saveBrowserComments,
  type BrowserPreviewActionStatus,
  type BrowserPreviewComment,
  type BrowserPreviewCommentAnnotation,
  type BrowserReviewSummaryStatus,
} from './ProfileDesktopLocalSection.helpers';

type DesktopBrowserPreviewSectionState = BrowserPreviewSectionProps & {
  refreshBrowserPreview: () => Promise<void>;
};

export function useDesktopBrowserPreviewSection(): DesktopBrowserPreviewSectionState {
  const [browserUrl, setBrowserUrl] = useState('http://localhost:3000');
  const [browserPreview, setBrowserPreview] = useState<DesktopBrowserStatus | null>(null);
  const [browserPreviewActionStatus, setBrowserPreviewActionStatus] =
    useState<BrowserPreviewActionStatus>('idle');
  const [browserPreviewError, setBrowserPreviewError] = useState<string | null>(null);
  const [browserCommentText, setBrowserCommentText] = useState('');
  const [browserCommentTarget, setBrowserCommentTarget] = useState('');
  const [browserCommentAnnotation, setBrowserCommentAnnotation] =
    useState<BrowserPreviewCommentAnnotation | null>(null);
  const [browserInspection, setBrowserInspection] = useState<DesktopBrowserInspection | null>(null);
  const [browserDiagnostics, setBrowserDiagnostics] = useState<DesktopBrowserDiagnostics | null>(
    null
  );
  const [browserScreenshot, setBrowserScreenshot] = useState<DesktopBrowserScreenshotResult | null>(
    null
  );
  const [browserDevtools, setBrowserDevtools] = useState<DesktopBrowserDevtoolsStatus | null>(null);
  const [browserComments, setBrowserComments] = useState<BrowserPreviewComment[]>(() =>
    loadBrowserComments()
  );
  const [browserReviewSummary, setBrowserReviewSummary] = useState<string | null>(null);
  const [browserReviewSummaryStatus, setBrowserReviewSummaryStatus] =
    useState<BrowserReviewSummaryStatus>('idle');
  const [browserReviewSummaryError, setBrowserReviewSummaryError] = useState<string | null>(null);

  const applyBrowserPreviewStatus = (next: DesktopBrowserStatus) => {
    setBrowserPreview(next);
    if (next.currentUrl) {
      setBrowserUrl(next.currentUrl);
    }
  };

  const runBrowserPreviewOperation = async <T>(
    status: BrowserPreviewActionStatus,
    fallbackMessage: string,
    operation: () => Promise<T>,
    onSuccess?: (result: T) => void
  ): Promise<T | null> => {
    setBrowserPreviewActionStatus(status);
    setBrowserPreviewError(null);
    try {
      const result = await operation();
      onSuccess?.(result);
      setBrowserPreviewActionStatus('idle');
      return result;
    } catch (caught) {
      setBrowserPreviewError(caught instanceof Error ? caught.message : fallbackMessage);
      setBrowserPreviewActionStatus('error');
      return null;
    }
  };

  const openBrowserPreview = async () => {
    await runBrowserPreviewOperation(
      'opening',
      'Browser preview failed to open.',
      () => openDesktopBrowserPreview({ url: browserUrl }),
      applyBrowserPreviewStatus
    );
  };

  const syncBrowserPreview = async () => {
    await runBrowserPreviewOperation(
      'syncing',
      'Browser preview failed to sync.',
      getDesktopBrowserPreviewStatus,
      applyBrowserPreviewStatus
    );
  };

  const goBackBrowserPreview = async () => {
    await runBrowserPreviewOperation(
      'goingBack',
      'Browser preview failed to go back.',
      async () => {
        await goBackDesktopBrowserPreview();
        return getDesktopBrowserPreviewStatus();
      },
      applyBrowserPreviewStatus
    );
  };

  const goForwardBrowserPreview = async () => {
    await runBrowserPreviewOperation(
      'goingForward',
      'Browser preview failed to go forward.',
      async () => {
        await goForwardDesktopBrowserPreview();
        return getDesktopBrowserPreviewStatus();
      },
      applyBrowserPreviewStatus
    );
  };

  const reloadBrowserPreview = async () => {
    await runBrowserPreviewOperation(
      'reloading',
      'Browser preview failed to reload.',
      async () => {
        await reloadDesktopBrowserPreview();
        return getDesktopBrowserPreviewStatus();
      },
      applyBrowserPreviewStatus
    );
  };

  const closeBrowserPreview = async () => {
    await runBrowserPreviewOperation(
      'closing',
      'Browser preview failed to close.',
      async () => {
        await closeDesktopBrowserPreview();
        return getDesktopBrowserPreviewStatus();
      },
      setBrowserPreview
    );
  };

  const currentBrowserCommentUrl = browserCommentUrl(browserPreview, browserUrl);
  const currentBrowserComments = browserComments.filter(
    (comment) => comment.url === currentBrowserCommentUrl
  );

  const syncBrowserPreviewAnnotations = async (
    comments: BrowserPreviewComment[] = browserComments,
    url: string = currentBrowserCommentUrl
  ) => {
    await runBrowserPreviewOperation(
      'annotating',
      'Browser preview annotations failed.',
      () =>
        setDesktopBrowserPreviewAnnotations({
          annotations: browserCommentsToAnnotations(comments, url),
        }),
      (result) => {
        if (!result.ok) {
          setBrowserPreviewError(result.message);
        }
      }
    );
  };

  const clearBrowserPreviewAnnotations = async () => {
    await syncBrowserPreviewAnnotations([], currentBrowserCommentUrl);
  };

  const selectBrowserPreviewAnnotation = async (mode: 'point' | 'area') => {
    await runBrowserPreviewOperation(
      mode === 'area' ? 'selectingArea' : 'selectingPoint',
      'Browser preview selection failed.',
      async () => {
        const result: DesktopBrowserActionResult = await runDesktopBrowserPreviewAction({
          action: mode === 'area' ? 'selectArea' : 'selectPoint',
          mode,
        });
        if (!result.ok || !result.selection) {
          throw new Error(result.message || 'Browser preview selection failed.');
        }
        const annotation = browserSelectionToCommentAnnotation(result.selection);
        if (!annotation) {
          throw new Error('Browser preview selection did not include coordinates.');
        }
        return { annotation, result };
      },
      ({ annotation, result }) => {
        setBrowserCommentAnnotation(annotation);
        setBrowserCommentTarget(browserSelectionTarget(result.selection));
      }
    );
  };

  const inspectBrowserPreview = async () => {
    await runBrowserPreviewOperation(
      'inspecting',
      'Browser preview inspection failed.',
      () =>
        inspectDesktopBrowserPreview({
          selector: browserCommentTarget.trim() || null,
          maxElements: 12,
        }),
      (inspection) => {
        setBrowserInspection(inspection);
        if (inspection.url) {
          setBrowserUrl(inspection.url);
        }
      }
    );
  };

  const collectBrowserPreviewDiagnostics = async () => {
    await runBrowserPreviewOperation(
      'collectingDiagnostics',
      'Browser preview diagnostics failed.',
      getDesktopBrowserPreviewDiagnostics,
      (diagnostics) => {
        setBrowserDiagnostics(diagnostics);
        if (diagnostics.url) {
          setBrowserUrl(diagnostics.url);
        }
      }
    );
  };

  const clearBrowserPreviewDiagnostics = async () => {
    await runBrowserPreviewOperation(
      'clearingDiagnostics',
      'Browser preview diagnostics failed to clear.',
      clearDesktopBrowserPreviewDiagnostics,
      (result) => {
        if (!result.ok) {
          setBrowserPreviewError(result.message);
        }
        setBrowserDiagnostics(null);
      }
    );
  };

  const captureBrowserPreviewScreenshot = async () => {
    await runBrowserPreviewOperation(
      'capturingScreenshot',
      'Browser preview screenshot failed.',
      captureDesktopBrowserPreviewScreenshot,
      setBrowserScreenshot
    );
  };

  const openBrowserPreviewDevtools = async () => {
    await runBrowserPreviewOperation(
      'openingDevtools',
      'Browser preview devtools failed to open.',
      openDesktopBrowserPreviewDevtools,
      setBrowserDevtools
    );
  };

  const closeBrowserPreviewDevtools = async () => {
    await runBrowserPreviewOperation(
      'closingDevtools',
      'Browser preview devtools failed to close.',
      closeDesktopBrowserPreviewDevtools,
      setBrowserDevtools
    );
  };

  const resetBrowserReviewSummary = () => {
    setBrowserReviewSummary(null);
    setBrowserReviewSummaryStatus('idle');
    setBrowserReviewSummaryError(null);
  };

  const updateBrowserComments = (
    updater: (current: BrowserPreviewComment[]) => BrowserPreviewComment[]
  ) => {
    setBrowserComments((current) => {
      const next = updater(current).slice(0, MAX_BROWSER_COMMENTS);
      saveBrowserComments(next);
      if (browserPreview?.open) {
        void syncBrowserPreviewAnnotations(next, currentBrowserCommentUrl);
      }
      return next;
    });
    resetBrowserReviewSummary();
  };

  const addBrowserComment = () => {
    const text = browserCommentText.trim();
    if (!text) {
      setBrowserPreviewError('Enter a Browser preview comment.');
      return;
    }
    if (!currentBrowserCommentUrl) {
      setBrowserPreviewError('Open or enter a Browser preview URL before adding a comment.');
      return;
    }

    const target = browserCommentTarget.trim();
    updateBrowserComments((current) => [
      {
        id: createBrowserCommentId(),
        url: currentBrowserCommentUrl,
        text,
        target: target || null,
        annotation: browserCommentAnnotation,
        screenshotPath: browserScreenshot?.path ?? null,
        createdAt: Date.now(),
      },
      ...current,
    ]);
    setBrowserCommentText('');
    setBrowserCommentTarget('');
    setBrowserCommentAnnotation(null);
    setBrowserPreviewError(null);
  };

  const removeBrowserComment = (commentId: string) => {
    updateBrowserComments((current) => current.filter((comment) => comment.id !== commentId));
  };

  const clearCurrentBrowserComments = () => {
    updateBrowserComments((current) =>
      current.filter((comment) => comment.url !== currentBrowserCommentUrl)
    );
  };

  const clearAllBrowserComments = () => {
    updateBrowserComments(() => []);
  };

  const copyBrowserReviewSummary = async () => {
    const summary = formatBrowserReviewSummary(browserComments);
    if (!summary) {
      setBrowserReviewSummary(null);
      setBrowserReviewSummaryStatus('error');
      setBrowserReviewSummaryError('Add at least one Browser preview comment before exporting.');
      return;
    }

    setBrowserReviewSummary(summary);
    setBrowserReviewSummaryError(null);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(summary);
        setBrowserReviewSummaryStatus('copied');
        return;
      } catch {
        // Keep the generated notes visible when clipboard permission is denied.
      }
    }
    setBrowserReviewSummaryStatus('ready');
  };

  const useBrowserReviewSummaryAsPrompt = () => {
    const summary = formatBrowserReviewSummary(browserComments);
    if (!summary) {
      setBrowserReviewSummary(null);
      setBrowserReviewSummaryStatus('error');
      setBrowserReviewSummaryError('Add at least one Browser preview comment before exporting.');
      return;
    }

    const prompt = formatBrowserReviewPrompt(summary);
    setBrowserReviewSummary(summary);
    setBrowserReviewSummaryError(null);
    writeCapturedPromptDraft(prompt);
    window.dispatchEvent(
      new CustomEvent(PROMPT_DRAFT_CAPTURE_EVENT, {
        detail: { value: prompt },
      })
    );
    setBrowserReviewSummaryStatus('prompted');
  };

  const refreshBrowserPreview = useCallback(async () => {
    const [browserResult, browserDevtoolsResult] = await Promise.all([
      getDesktopBrowserPreviewStatus(),
      getDesktopBrowserPreviewDevtoolsStatus().catch(() => null),
    ]);
    setBrowserPreview(browserResult);
    setBrowserDevtools(browserDevtoolsResult);
    if (browserResult.currentUrl) {
      setBrowserUrl(browserResult.currentUrl);
    }
  }, []);

  return {
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
    browserCommentsCount: browserComments.length,
    browserReviewSummaryStatus,
    browserReviewSummaryError,
    browserReviewSummary,
    refreshBrowserPreview,
  };
}
