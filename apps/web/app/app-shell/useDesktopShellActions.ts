import { useCallback, useEffect, useState } from 'react';

import { logger } from '../lib/logger';
import { initializeDesktopAppServer } from '../lib/platform/desktop/app-server';
import { invokeTauri } from '../lib/platform/desktop/bridge';

interface DesktopUpdateStatus {
  available: boolean;
  currentVersion: string;
  version?: string | null;
  notes?: string | null;
}

export function useDesktopShellActions(platformRuntime: string) {
  const [availableUpdate, setAvailableUpdate] = useState<DesktopUpdateStatus | null>(null);

  useEffect(() => {
    if (platformRuntime !== 'desktop') {
      setAvailableUpdate(null);
      return;
    }

    initializeDesktopAppServer().catch((error: unknown) => {
      logger.error('Failed to initialize desktop app-server', { error });
    });
  }, [platformRuntime]);

  const checkForUpdates = useCallback(
    async ({ alertWhenCurrent }: { alertWhenCurrent: boolean }) => {
      const update = await invokeTauri<DesktopUpdateStatus>('desktop_update_check');
      setAvailableUpdate(update.available && update.version ? update : null);

      if (!update.available || !update.version) {
        if (alertWhenCurrent) {
          window.alert(`TaskForceAI is up to date (${update.currentVersion}).`);
        }
        return;
      }

      if (!alertWhenCurrent) {
        return;
      }

      const shouldInstall = window.confirm(
        `TaskForceAI ${update.version} is available. Install it now?`
      );
      if (!shouldInstall) {
        return;
      }

      await invokeTauri('desktop_update_install');
    },
    []
  );

  useEffect(() => {
    if (platformRuntime !== 'desktop' || import.meta.env.DEV) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void checkForUpdates({ alertWhenCurrent: false }).catch((error: unknown) => {
        logger.warn('Background desktop update check failed', { error });
      });
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [checkForUpdates, platformRuntime]);

  const handleCheckForUpdates = useCallback(() => {
    if (platformRuntime !== 'desktop') {
      return;
    }

    void checkForUpdates({ alertWhenCurrent: true }).catch((error: unknown) => {
      logger.error('Failed to check for desktop updates', { error });
      window.alert('Could not check for updates. Please try again later.');
    });
  }, [checkForUpdates, platformRuntime]);

  return {
    availableUpdate: platformRuntime === 'desktop' ? availableUpdate : null,
    handleCheckForUpdates: platformRuntime === 'desktop' ? handleCheckForUpdates : undefined,
  };
}
