import { useEffect } from 'react';

import { logger } from '@taskforceai/web/app/lib/logger';
import { listenTauriEvent } from '../platform/bridge';

interface DesktopMenuActions {
  desktopRuntime: boolean;
  onCheckForUpdates?: () => void;
  onOpenBrowserPreview: () => void;
  onOpenSettings: () => void;
}

export function useDesktopMenuActions({
  desktopRuntime,
  onCheckForUpdates,
  onOpenBrowserPreview,
  onOpenSettings,
}: DesktopMenuActions) {
  useEffect(() => {
    if (!desktopRuntime) return;

    let active = true;
    const unlistenCallbacks: Array<() => void> = [];

    const registerMenuListeners = async () => {
      try {
        const [unlistenSettings, unlistenUpdates, unlistenBrowserPreview] = await Promise.all([
          listenTauriEvent('desktop-menu:settings', onOpenSettings),
          listenTauriEvent('desktop-menu:check-for-updates', () => onCheckForUpdates?.()),
          listenTauriEvent('desktop-menu:browser-preview', onOpenBrowserPreview),
        ]);

        if (!active) {
          unlistenSettings();
          unlistenUpdates();
          unlistenBrowserPreview();
          return;
        }

        unlistenCallbacks.push(unlistenSettings, unlistenUpdates, unlistenBrowserPreview);
      } catch (error) {
        logger.warn('Failed to register desktop menu listeners', { error });
      }
    };

    void registerMenuListeners();

    return () => {
      active = false;
      for (const unlisten of unlistenCallbacks) unlisten();
    };
  }, [desktopRuntime, onCheckForUpdates, onOpenBrowserPreview, onOpenSettings]);
}
