import { useCallback, useEffect, useState } from 'react';

import { logger } from '@taskforceai/web/app/lib/logger';
import { confirmDialog } from '@taskforceai/web/app/lib/platform/confirm-dialog';
import { initializeDesktopAppServer } from '../platform/app-server';
import { invokeTauri } from '../platform/bridge';

interface DesktopUpdateStatus {
  available: boolean;
  currentVersion: string;
  version?: string | null;
  notes?: string | null;
}

export type DesktopUpdateAction = 'idle' | 'checking' | 'installing';

export function useDesktopShellActions(platformRuntime: string) {
  const [availableUpdate, setAvailableUpdate] = useState<DesktopUpdateStatus | null>(null);
  const [desktopUpdateAction, setDesktopUpdateAction] = useState<DesktopUpdateAction>('idle');
  const [desktopUpdateMessage, setDesktopUpdateMessage] = useState<string | null>(null);

  useEffect(() => {
    if (platformRuntime !== 'desktop') {
      setAvailableUpdate(null);
      setDesktopUpdateAction('idle');
      setDesktopUpdateMessage(null);
      return;
    }

    initializeDesktopAppServer().catch((error: unknown) => {
      logger.error('Failed to initialize desktop app-server', { error });
    });
  }, [platformRuntime]);

  const installUpdate = useCallback(async (update: DesktopUpdateStatus) => {
    if (!update.version) return;

    const shouldInstall = await confirmDialog(
      `TaskForceAI ${update.version} is ready to install. The app will restart after the update is applied.`,
      { title: 'Install Update', confirmLabel: 'Install' }
    );
    if (!shouldInstall) return;

    setDesktopUpdateAction('installing');
    setDesktopUpdateMessage(`Installing TaskForceAI ${update.version}...`);
    try {
      await invokeTauri('desktop_update_install');
    } catch (error) {
      logger.error('Failed to install desktop update', { error });
      setDesktopUpdateMessage(
        'Could not install the update automatically. Download the latest desktop installer from taskforceai.chat/downloads.'
      );
    } finally {
      setDesktopUpdateAction('idle');
    }
  }, []);

  const checkForUpdates = useCallback(
    async ({ alertWhenCurrent }: { alertWhenCurrent: boolean }) => {
      if (alertWhenCurrent) {
        setDesktopUpdateAction('checking');
        setDesktopUpdateMessage(null);
      }

      try {
        const update = await invokeTauri<DesktopUpdateStatus>('desktop_update_check');
        setAvailableUpdate(update.available && update.version ? update : null);

        if (!update.available || !update.version) {
          if (alertWhenCurrent) {
            setDesktopUpdateMessage(`TaskForceAI is up to date (${update.currentVersion}).`);
          }
          return;
        }

        if (alertWhenCurrent) await installUpdate(update);
      } finally {
        if (alertWhenCurrent) {
          setDesktopUpdateAction((currentAction) =>
            currentAction === 'checking' ? 'idle' : currentAction
          );
        }
      }
    },
    [installUpdate]
  );

  useEffect(() => {
    if (platformRuntime !== 'desktop' || import.meta.env.DEV) return;

    const timeoutId = window.setTimeout(() => {
      void checkForUpdates({ alertWhenCurrent: false }).catch((error: unknown) => {
        logger.warn('Background desktop update check failed', { error });
      });
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [checkForUpdates, platformRuntime]);

  const handleCheckForUpdates = useCallback(() => {
    if (platformRuntime !== 'desktop' || desktopUpdateAction !== 'idle') return;

    if (availableUpdate?.version) {
      void installUpdate(availableUpdate);
      return;
    }

    void checkForUpdates({ alertWhenCurrent: true }).catch((error: unknown) => {
      logger.error('Failed to check for desktop updates', { error });
      setDesktopUpdateMessage('Could not check for updates. Please try again later.');
      setDesktopUpdateAction('idle');
    });
  }, [availableUpdate, checkForUpdates, desktopUpdateAction, installUpdate, platformRuntime]);

  return {
    availableUpdate: platformRuntime === 'desktop' ? availableUpdate : null,
    desktopUpdateAction: platformRuntime === 'desktop' ? desktopUpdateAction : 'idle',
    desktopUpdateMessage: platformRuntime === 'desktop' ? desktopUpdateMessage : null,
    handleCheckForUpdates: platformRuntime === 'desktop' ? handleCheckForUpdates : undefined,
  };
}
