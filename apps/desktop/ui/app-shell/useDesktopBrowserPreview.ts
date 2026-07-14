import { useCallback, useEffect, useState } from 'react';

import { logger } from '@taskforceai/web/app/lib/logger';
import { openDesktopBrowserPreview } from '../platform/app-server';

const isExplicitBrowserPreviewHref = (href: string | null) => {
  if (!href) return false;
  const trimmed = href.trim().toLowerCase();
  return (
    trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('file://')
  );
};

export function useDesktopBrowserPreview(desktopRuntime: boolean) {
  const [isBrowserPreviewOpen, setIsBrowserPreviewOpen] = useState(false);

  useEffect(() => {
    if (!desktopRuntime) setIsBrowserPreviewOpen(false);
  }, [desktopRuntime]);

  const openBrowserPreview = useCallback(() => {
    if (desktopRuntime) setIsBrowserPreviewOpen(true);
  }, [desktopRuntime]);

  const closeBrowserPreview = useCallback(() => {
    setIsBrowserPreviewOpen(false);
  }, []);

  const openBrowserPreviewUrl = useCallback(
    (url: string) => {
      if (!desktopRuntime) return;
      setIsBrowserPreviewOpen(true);
      void openDesktopBrowserPreview({ url }).catch((error: unknown) => {
        logger.warn('Failed to open URL in desktop browser preview', { error, url });
      });
    },
    [desktopRuntime]
  );

  useEffect(() => {
    if (!desktopRuntime) return;

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      const href = anchor?.getAttribute('href') ?? null;
      if (
        !anchor ||
        anchor.hasAttribute('download') ||
        anchor.dataset['desktopBrowserPreview'] === 'false' ||
        !isExplicitBrowserPreviewHref(href)
      ) {
        return;
      }

      event.preventDefault();
      const previewUrl = anchor.href || href;
      if (previewUrl) openBrowserPreviewUrl(previewUrl);
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [desktopRuntime, openBrowserPreviewUrl]);

  return {
    closeBrowserPreview,
    isBrowserPreviewOpen,
    openBrowserPreview,
  };
}
