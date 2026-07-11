import { getFrontendSecurityHeaders } from '@taskforceai/config/frontend-security-headers';
import { createFrontendStart } from '@taskforceai/react-core/start';

export const startInstance = createFrontendStart((environment) =>
  getFrontendSecurityHeaders('marketing', {
    environment,
    includeStrictTransportSecurity: environment === 'production',
  })
);
