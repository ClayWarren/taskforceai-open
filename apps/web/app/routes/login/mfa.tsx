import { createFileRoute } from '@tanstack/react-router';

import MFALoginPage from '../../(auth)/login/mfa/page';

export const Route = createFileRoute('/login/mfa')({
  validateSearch: (search: Record<string, unknown>) => ({
    callbackUrl: typeof search['callbackUrl'] === 'string' ? search['callbackUrl'] : undefined,
    mfa_token: typeof search['mfa_token'] === 'string' ? search['mfa_token'] : undefined,
  }),
  component: MFALoginPage,
});
