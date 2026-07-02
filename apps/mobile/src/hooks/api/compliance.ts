import { useMutation } from '@tanstack/react-query';

import { getMobileClient } from '../../api/client';
import { mobileLogger } from '../../logger';

export const useExportDataMutation = () => {
  const client = getMobileClient();
  return useMutation({
    mutationFn: async () => client.exportGdprData(),
    onError: (error) => {
      mobileLogger.error('[useExportDataMutation] Failed to export GDPR data', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error
      });
    },
  });
};

export const useDeleteAccountMutation = () => {
  const client = getMobileClient();
  return useMutation({
    mutationFn: async (confirmEmail: string) =>
      client.deleteAccount({ confirmEmail }),
    onError: (error) => {
      mobileLogger.error('[useDeleteAccountMutation] Failed to delete account', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error
      });
    },
  });
};
