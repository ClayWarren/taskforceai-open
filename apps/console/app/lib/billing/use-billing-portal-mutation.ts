import { useMutation } from '@tanstack/react-query';

import { createPortalSession } from '@taskforceai/api-client/api/billing';
import { logger } from '../logger';
import { showAlert } from '@taskforceai/browser-runtime/browser-actions';
import { redactBillingUrlForLogs, resolveTrustedBillingPortalUrl } from '../utils/billing-portal';

const notify = (message: string) => {
  const result = showAlert(message);
  if (!result.ok) {
    logger.warn('Failed to show billing alert', { error: result.error });
  }
};

export const useBillingPortalMutation = () =>
  useMutation({
    mutationFn: () => createPortalSession(),
    onSuccess: (result) => {
      if (!result.ok) {
        notify(`Failed to open billing portal: ${result.error.message}`);
        return;
      }

      if (!result.value.url) {
        notify('Failed to open billing portal: missing redirect URL.');
        return;
      }

      const redirectUrl = resolveTrustedBillingPortalUrl(result.value.url);
      if (redirectUrl.ok) {
        window.location.href = redirectUrl.value;
        return;
      }

      logger.warn('Rejected billing portal redirect URL', {
        url: redactBillingUrlForLogs(result.value.url),
        reason: redirectUrl.error.kind,
      });
      notify('Billing portal redirect was blocked because the URL was not trusted.');
    },
    onError: (error) => {
      logger.error('Failed to create billing portal session', { error });
      notify('Failed to open billing portal. Please try again.');
    },
  });
