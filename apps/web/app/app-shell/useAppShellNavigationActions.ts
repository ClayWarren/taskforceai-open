import { useCallback } from 'react';

import {
  getDesktopAppServerAuthStatus,
  openDesktopExternalUrl,
  pollDesktopAppServerDeviceLogin,
  startDesktopAppServerDeviceLogin,
} from '../lib/platform/desktop/app-server';
import { dispatchDesktopAppServerAuthChanged } from '../lib/platform/desktop/auth-events';
import { waitForTauriBridge } from '../lib/platform/desktop/bridge';
import { getSignInUrl } from '../lib/auth/sign-in';
import { logger } from '../lib/logger';

interface UseAppShellNavigationActionsOptions {
  isAuthenticated: boolean;
  messageSession: {
    conversation: {
      onSendMessage: (content: string) => void;
    };
  };
  openProfileModal: (params: { onOpen: () => void }) => void;
  router: {
    push: (path: string) => Promise<void> | void;
  };
  platformRuntime: 'browser' | 'desktop';
  setIsSidebarOpen: (open: boolean) => void;
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const waitForDesktopAuthConfirmation = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- Auth status confirmation is intentionally sequential.
    const status = await getDesktopAppServerAuthStatus();
    if (status.authenticated) {
      return true;
    }
    // eslint-disable-next-line no-await-in-loop -- Keep the confirmation loop paced.
    await wait(500);
  }
  return false;
};

const withDesktopDeviceLoginHint = (url: string) => {
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set('client', 'desktop');
    return parsed.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}client=desktop`;
  }
};

export const useAppShellNavigationActions = ({
  isAuthenticated,
  messageSession,
  openProfileModal,
  platformRuntime,
  router,
  setIsSidebarOpen,
}: UseAppShellNavigationActionsOptions) => {
  const handleLogoClick = useCallback(() => {
    void Promise.resolve(router.push('/'));
  }, [router]);

  const handleOpenChangelog = useCallback(() => {
    setIsSidebarOpen(false);
    const marketingBase =
      import.meta.env['VITE_MARKETING_URL'] ||
      import.meta.env['VITE_SITE_URL'] ||
      'https://taskforceai.chat';
    window.location.href = new URL('/changelog', marketingBase).toString();
  }, [setIsSidebarOpen]);

  const handleOpenProfile = useCallback(() => {
    if (!isAuthenticated) {
      logger.debug('[AppShell] Ignoring profile open while unauthenticated');
      return;
    }
    logger.info('[AppShell] Opening profile modal');
    openProfileModal({
      onOpen: () => {
        setIsSidebarOpen(false);
      },
    });
  }, [isAuthenticated, openProfileModal, setIsSidebarOpen]);

  const handleSendMessage = useCallback(
    (content: string) => {
      messageSession.conversation.onSendMessage(content);
    },
    [messageSession.conversation]
  );

  const handleSignInClick = useCallback(() => {
    void (async () => {
      const isDesktopRuntime = platformRuntime === 'desktop' || (await waitForTauriBridge(500));

      if (!isDesktopRuntime) {
        window.location.assign(getSignInUrl('/'));
        return;
      }

      try {
        const login = await startDesktopAppServerDeviceLogin();
        await openDesktopExternalUrl(
          withDesktopDeviceLoginHint(login.verificationUriComplete || login.verificationUri)
        );
        logger.info('[AppShell] Desktop sign-in opened in browser', { userCode: login.userCode });

        const expiresAt = Date.now() + Math.max(login.expiresIn, 60) * 1000;
        let intervalMs = Math.max(login.interval || 5, 1) * 1000;

        while (Date.now() < expiresAt) {
          // oxlint-disable-next-line no-await-in-loop -- Device login polling must stay sequential.
          const result = await pollDesktopAppServerDeviceLogin(login.deviceCode);
          if (result.status === 'approved') {
            // oxlint-disable-next-line no-await-in-loop -- Auth confirmation depends on approval.
            const confirmed = await waitForDesktopAuthConfirmation();
            if (!confirmed) {
              throw new Error(
                'Desktop sign-in was approved, but the app did not save the session.'
              );
            }
            dispatchDesktopAppServerAuthChanged();
            return;
          }
          if (result.status === 'slow_down') {
            intervalMs += 5_000;
            continue;
          }
          if (result.status !== 'pending') {
            throw new Error(result.message || `Desktop sign-in failed: ${result.status}`);
          }
          if (result.interval) {
            intervalMs = Math.max(result.interval, 1) * 1000;
          }
          // eslint-disable-next-line no-await-in-loop -- Polling cadence comes from the auth server.
          await wait(intervalMs);
        }

        throw new Error('Desktop sign-in expired. Please try again.');
      } catch (error) {
        logger.error('[AppShell] Desktop sign-in failed', { error });
        window.alert(error instanceof Error ? error.message : 'Desktop sign-in failed.');
      }
    })();
  }, [platformRuntime]);

  return {
    handleLogoClick,
    handleOpenChangelog,
    handleOpenProfile,
    handleSendMessage,
    handleSignInClick,
  };
};
