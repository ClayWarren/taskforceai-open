import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking } from 'react-native';

import * as FileSystem from '../utils/file-system';
import { useAuth } from '../contexts/AuthContext';
import { useDeleteAccountMutation, useExportDataMutation } from '../hooks/api/compliance';
import { createModuleLogger } from '../logger';

const logger = createModuleLogger('useProfileActions');

export function useProfileActions(onClose: () => void) {
  const { user, logout } = useAuth();
  const { t } = useTranslation();

  const [isAccountActionLoading, setIsAccountActionLoading] = useState(false);

  const exportDataMutation = useExportDataMutation();
  const deleteAccountMutation = useDeleteAccountMutation();

  const handleLogout = () => {
    Alert.alert(t('mobile.profile.logoutTitle'), t('mobile.profile.logoutMessage'), [
      { text: t('mobile.profile.cancel'), style: 'cancel' },
      {
        text: t('mobile.profile.logoutButton'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await logout();
            onClose();
          })();
        },
      },
    ]);
  };

  const handleDataExport = async () => {
    if (!user) return;

    setIsAccountActionLoading(true);
    try {
      const payload = await exportDataMutation.mutateAsync();
      const identifier = user.email.replace(/[@.]/g, '-');
      const filename = `taskforceai-data-export-${identifier}-${new Date().toISOString().split('T')[0]}.json`;
      const fileUri = `${FileSystem.documentDirectory ?? ''}${filename}`;

      await FileSystem.writeAsStringAsync(fileUri, String(payload), {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert(
          t('mobile.profile.exportCompleteTitle'),
          t('mobile.profile.exportCompleteMessage', { path: fileUri })
        );
      }
    } catch (error) {
      logger.error('Data export failed', { error, email: user.email });
      Alert.alert(t('mobile.profile.exportErrorTitle'), t('mobile.profile.exportErrorMessage'));
    } finally {
      setIsAccountActionLoading(false);
    }
  };

  const handleDeleteAccount = () => {
    if (!user) return;

    const executeDelete = async () => {
      setIsAccountActionLoading(true);
      try {
        await deleteAccountMutation.mutateAsync(user.email);

        Alert.alert(
          t('mobile.profile.deleteSuccessTitle'),
          t('mobile.profile.deleteSuccessMessage')
        );
        await logout();
        onClose();
      } catch (error) {
        logger.error('Account deletion failed', { error, email: user.email });
        Alert.alert(t('mobile.profile.deleteErrorTitle'), t('mobile.profile.deleteErrorMessage'));
      } finally {
        setIsAccountActionLoading(false);
      }
    };

    Alert.alert(
      t('mobile.profile.deleteTitle'),
      t('mobile.profile.deleteMessage', { username: user.email }),
      [
        { text: t('mobile.profile.cancel'), style: 'cancel' },
        {
          text: t('mobile.profile.confirmDelete'),
          style: 'destructive',
          onPress: () => {
            void executeDelete();
          },
        },
      ]
    );
  };

  const openBillingPortal = () => {
    Linking.openURL('https://taskforceai.chat/pricing').catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to open billing portal', { error: errorMessage });
    });
  };

  return {
    handleLogout,
    handleDataExport,
    handleDeleteAccount,
    openBillingPortal,
    isAccountActionLoading,
  };
}
