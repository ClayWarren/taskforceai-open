import { Alert } from 'react-native';

import { useSync } from '../../contexts/SyncContext';
import { createModuleLogger } from '../../logger';
import { dbManager } from '../../storage/database-manager';

const logger = createModuleLogger('SettingsMaintenanceActions');

interface UseSettingsMaintenanceActionsOptions {
  onClearCache?: () => Promise<void>;
  t: (key: string, options?: { defaultValue?: string }) => string;
}

export function useSettingsMaintenanceActions({
  onClearCache,
  t,
}: UseSettingsMaintenanceActionsOptions) {
  const { sync } = useSync();

  const handleClearCache = () => {
    Alert.alert(
      t('mobile.settings.clearCacheTitle'),
      t('mobile.settings.clearCacheMessage'),
      [
        { text: t('mobile.settings.cancel'), style: 'cancel' },
        {
          text: t('mobile.settings.confirm'),
          style: 'destructive',
          onPress: () => {
            if (onClearCache) {
              void onClearCache();
            } else {
              Alert.alert(t('mobile.settings.error'), t('mobile.settings.noHandler'));
            }
          },
        },
      ]
    );
  };

  const handleResetDatabase = () => {
    Alert.alert('Reset Database', 'This will delete all local data. Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await dbManager.resetDatabase();
              Alert.alert('Success', 'Database has been reset. Please restart the app.');
            } catch (error) {
              logger.error('Database reset failed', { error });
              Alert.alert('Error', 'Failed to reset database.');
            }
          })();
        },
      },
    ]);
  };

  const handleForceSync = async () => {
    try {
      await sync({ throwOnError: true });
      Alert.alert(t('mobile.settings.syncSuccessTitle'), t('mobile.settings.syncSuccessMessage'));
    } catch (error) {
      logger.error('Manual sync failed', { error });
      Alert.alert(t('mobile.settings.syncErrorTitle'), t('mobile.settings.syncErrorMessage'));
    }
  };

  return {
    handleClearCache,
    handleForceSync,
    handleResetDatabase,
  };
}
