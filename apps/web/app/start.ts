import { authClient } from '@taskforceai/api-client/auth/auth-client';
import { getRuntimeEnv } from '@taskforceai/config/app-env';
import { getFrontendSecurityHeaders } from '@taskforceai/config/frontend-security-headers';
import { createFrontendStart } from '@taskforceai/react-core/start';

const environment = getRuntimeEnv('NODE_ENV') === 'production' ? 'production' : 'development';

authClient.configure({
  apiUrl: getRuntimeEnv('NEXT_PUBLIC_API_URL'),
  authUrl: getRuntimeEnv('NEXT_PUBLIC_AUTH_URL'),
});

export const startInstance = createFrontendStart(environment, (runtimeEnvironment) =>
  getFrontendSecurityHeaders('web', {
    environment: runtimeEnvironment,
    includeStrictTransportSecurity: runtimeEnvironment === 'production',
  })
);
