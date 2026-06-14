import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { useAuth } from '../contexts/AuthContext';
import { usePreferences } from '../contexts/PreferencesContext';
import { ensurePushRegistration, unregisterPushNotifications } from '../notifications/registration';
import { createModuleLogger } from '../logger';

const logger = createModuleLogger('useNotificationsBootstrap');

export function useNotificationsBootstrap() {
  const { isAuthenticated, isLoading } = useAuth();
  const { hasLoadedPreferences, notificationsEnabled, setNotificationsEnabled } = usePreferences();
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;

    const syncNotifications = async () => {
      if (!hasLoadedPreferences || isLoading || !isAuthenticated) {
        return;
      }

      if (!notificationsEnabled) {
        await unregisterPushNotifications();
        return;
      }

      try {
        const { status } = await ensurePushRegistration({ promptUser: false });
        if (!cancelled && status === 'denied') {
          await setNotificationsEnabled(false);
          Alert.alert(
            t('mobile.settings.notificationsSystemDisabledTitle'),
            t('mobile.settings.notificationsSystemDisabledMessage')
          );
        }
      } catch (error) {
        logger.error('Failed to refresh push registration', { error });
      }
    };

    void syncNotifications();

    return () => {
      cancelled = true;
    };
  }, [hasLoadedPreferences, isAuthenticated, isLoading, notificationsEnabled, setNotificationsEnabled, t]);
}
