'use client';

import clsx from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  Globe2,
  MoreVertical,
  PanelRightClose,
  Plus,
  RefreshCw,
} from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  closeDesktopBrowserPreview,
  getDesktopBrowserPreviewStatus,
  goBackDesktopBrowserPreview,
  goForwardDesktopBrowserPreview,
  mountDesktopBrowserPreview,
  openDesktopBrowserPreview,
  reloadDesktopBrowserPreview,
  type DesktopBrowserStatus,
} from '../platform/app-server';
import { logger } from '@taskforceai/web/app/lib/logger';
import { DesktopBrowserDeveloperPanel } from './DesktopBrowserDeveloperPanel';

interface DesktopBrowserPanelProps {
  open: boolean;
  onClose: () => void;
  width?: string;
  developerModeEnabled?: boolean;
}

const iconButtonClassName = clsx(
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent',
  'text-slate-300 transition hover:border-white/10 hover:bg-white/8 hover:text-white',
  'focus-visible:ring-2 focus-visible:ring-blue-300/70 focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-transparent disabled:hover:bg-transparent'
);

const isBrowserStartPageUrl = (url: string | null | undefined) =>
  Boolean(url?.includes('/desktop-browser-start.html'));

const nativeWebviewTopInset = 16;

export function DesktopBrowserPanel({
  open,
  onClose,
  width = 'clamp(380px, 42vw, 760px)',
  developerModeEnabled = false,
}: DesktopBrowserPanelProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const hasOpenedRef = useRef(false);
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<DesktopBrowserStatus | null>(null);
  const [action, setAction] = useState<'idle' | 'mounting' | 'opening' | 'navigating'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [developerOpen, setDeveloperOpen] = useState(false);

  const syncAddressFromStatus = useCallback((nextStatus: DesktopBrowserStatus) => {
    setStatus(nextStatus);
    if (nextStatus.currentUrl && !isBrowserStartPageUrl(nextStatus.currentUrl)) {
      setAddress(nextStatus.currentUrl);
    }
  }, []);

  const mountIntoSlot = useCallback(async () => {
    const slot = contentRef.current;
    if (!open || !slot) {
      return null;
    }

    const rect = slot.getBoundingClientRect();
    const mountHeight = rect.height - nativeWebviewTopInset;
    if (rect.width < 120 || mountHeight < 160) {
      return null;
    }

    const nextStatus = await mountDesktopBrowserPreview({
      bounds: {
        x: rect.left,
        y: rect.top + nativeWebviewTopInset,
        width: rect.width,
        height: mountHeight,
      },
    });
    syncAddressFromStatus(nextStatus);
    return nextStatus;
  }, [open, syncAddressFromStatus]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    let animationFrame = 0;
    let cancelled = false;
    const scheduleMount = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }
        setAction((current) => (current === 'idle' ? 'mounting' : current));
        mountIntoSlot()
          .then(() => {
            if (!cancelled) {
              setError(null);
              setAction('idle');
            }
          })
          .catch((caught: unknown) => {
            if (!cancelled) {
              logger.warn('Failed to mount desktop browser preview', {
                error: caught,
              });
              setError(caught instanceof Error ? caught.message : 'Browser failed to mount.');
              setAction('idle');
            }
          });
      });
    };

    scheduleMount();
    const ResizeObserverCtor = window.ResizeObserver;
    const observer =
      ResizeObserverCtor && contentRef.current
        ? new ResizeObserverCtor(() => scheduleMount())
        : null;
    if (contentRef.current) {
      observer?.observe(contentRef.current);
    }
    window.addEventListener('resize', scheduleMount);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMount);
    };
  }, [mountIntoSlot, open]);

  useEffect(() => {
    if (open) {
      hasOpenedRef.current = true;
      return;
    }
    if (!hasOpenedRef.current) {
      return;
    }

    setError(null);
    setStatus(null);
    void closeDesktopBrowserPreview().catch((caught: unknown) => {
      logger.debug('Failed to close hidden desktop browser preview', {
        error: caught,
      });
    });
  }, [open]);

  const runNavigationAction = useCallback(
    async (callback: () => Promise<void>) => {
      setAction('navigating');
      setError(null);
      try {
        await callback();
        const nextStatus = await getDesktopBrowserPreviewStatus();
        syncAddressFromStatus(nextStatus);
      } catch (caught) {
        logger.warn('Desktop browser preview navigation failed', {
          error: caught,
        });
        setError(caught instanceof Error ? caught.message : 'Browser navigation failed.');
      } finally {
        setAction('idle');
      }
    },
    [syncAddressFromStatus]
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const url = address.trim();
      if (!url) {
        await mountIntoSlot().catch((caught: unknown) => {
          logger.warn('Failed to show desktop browser start page', {
            error: caught,
          });
        });
        return;
      }

      setAction('opening');
      setError(null);
      try {
        await mountIntoSlot();
        const nextStatus = await openDesktopBrowserPreview({ url });
        syncAddressFromStatus(nextStatus);
      } catch (caught) {
        logger.warn('Failed to open desktop browser preview URL', {
          error: caught,
          url,
        });
        setError(caught instanceof Error ? caught.message : 'Browser failed to open URL.');
      } finally {
        setAction('idle');
      }
    },
    [address, mountIntoSlot, syncAddressFromStatus]
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) {
    return null;
  }

  const busy = action !== 'idle';

  return (
    <aside
      aria-label="Desktop browser"
      className={clsx(
        'desktop-browser-panel fixed top-0 right-0 bottom-0 z-[220] hidden min-h-0 flex-col isolate',
        'border-l border-white/10 bg-[#101010] text-slate-100 shadow-[-24px_0_48px_rgba(0,0,0,0.28)] md:flex'
      )}
      style={{ width }}
    >
      <div className="relative z-10 flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-[#101010] px-4">
        <button
          type="button"
          className="inline-flex h-8 max-w-[220px] items-center gap-2 rounded-full bg-white/7 px-3 text-sm font-semibold text-slate-100"
          onClick={() => {
            setAddress('');
            void mountIntoSlot();
          }}
        >
          <Globe2 aria-hidden="true" size={17} strokeWidth={2.1} />
          <span className="truncate">New tab</span>
        </button>
        <button
          type="button"
          className={iconButtonClassName}
          aria-label="New tab"
          onClick={() => {
            setAddress('');
            void mountIntoSlot();
          }}
        >
          <Plus aria-hidden="true" size={18} strokeWidth={2.1} />
        </button>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          className={iconButtonClassName}
          aria-label="Close browser"
          onClick={handleClose}
        >
          <PanelRightClose aria-hidden="true" size={18} strokeWidth={2.1} />
        </button>
      </div>

      <form
        className="relative z-10 grid h-16 shrink-0 grid-cols-[auto_auto_auto_minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-white/10 bg-[#101010] px-4 py-3"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <button
          type="button"
          className={iconButtonClassName}
          disabled={busy || !status?.open}
          aria-label="Back"
          onClick={() => void runNavigationAction(goBackDesktopBrowserPreview)}
        >
          <ArrowLeft aria-hidden="true" size={18} strokeWidth={2.1} />
        </button>
        <button
          type="button"
          className={iconButtonClassName}
          disabled={busy || !status?.open}
          aria-label="Forward"
          onClick={() => void runNavigationAction(goForwardDesktopBrowserPreview)}
        >
          <ArrowRight aria-hidden="true" size={18} strokeWidth={2.1} />
        </button>
        <button
          type="button"
          className={iconButtonClassName}
          disabled={busy || !status?.open}
          aria-label="Reload"
          onClick={() => void runNavigationAction(reloadDesktopBrowserPreview)}
        >
          <RefreshCw
            aria-hidden="true"
            className={clsx(action === 'navigating' && 'animate-spin')}
            size={17}
            strokeWidth={2.1}
          />
        </button>
        <label className="relative min-w-0" aria-label="Browser URL">
          <input
            className={clsx(
              'h-10 w-full min-w-0 rounded-full border border-white/12 bg-black/20 px-4 pr-16 text-sm leading-10 text-slate-100',
              'outline-none transition placeholder:text-slate-400 focus:border-blue-300/70 focus:ring-2 focus:ring-blue-300/20'
            )}
            value={address}
            onChange={(event) => setAddress(event.currentTarget.value)}
            placeholder="Enter a URL"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="absolute top-1 right-1 h-7 rounded-full px-3 text-xs font-semibold text-slate-300 transition hover:bg-white/8 hover:text-white"
            disabled={busy}
          >
            {action === 'opening' ? 'Opening' : 'Open'}
          </button>
        </label>
        <button type="submit" className={iconButtonClassName} disabled={busy} aria-label="Open URL">
          <span className="text-xs font-semibold">Go</span>
        </button>
        <button
          type="button"
          className={iconButtonClassName}
          aria-label="Browser menu"
          onClick={() => {
            if (developerModeEnabled) setDeveloperOpen((value) => !value);
          }}
        >
          <MoreVertical aria-hidden="true" size={18} strokeWidth={2.1} />
        </button>
      </form>

      <DesktopBrowserDeveloperPanel open={developerModeEnabled && developerOpen} />

      {error ? (
        <div className="border-b border-red-300/20 bg-red-500/12 px-4 py-2 text-xs text-red-100">
          {error}
        </div>
      ) : null}

      <div
        ref={contentRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[#111111]"
        data-testid="desktop-browser-content-slot"
        style={{ paddingTop: nativeWebviewTopInset }}
      />
    </aside>
  );
}
