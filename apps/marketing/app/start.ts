import { getRuntimeEnv } from '@taskforceai/config/app-env';
import { getFrontendSecurityHeaders } from '@taskforceai/config/frontend-security-headers';
import { createFrontendStart } from '@taskforceai/react-core/start';

const environment = getRuntimeEnv('NODE_ENV') === 'production' ? 'production' : 'development';

export const startInstance = createFrontendStart(environment, (runtimeEnvironment) =>
  getFrontendSecurityHeaders('marketing', {
    environment: runtimeEnvironment,
    includeStrictTransportSecurity: runtimeEnvironment === 'production',
  })
);
