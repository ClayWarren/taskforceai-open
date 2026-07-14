#!/usr/bin/env bun
import { buildFrontendContentSecurityPolicy } from '@taskforceai/config/frontend-security-headers';
import {
  buildVercelOutput,
  filesystemRoute,
  handleBuildFailure,
  iconCacheRoute,
  securityHeaderRoute,
  serverlessFallbackRoute,
  staticAssetRoutes,
} from '../../../scripts/vercel/build-output';
import { authLogoutRedirect, buildOutputConsoleApiRoutes } from '../../../scripts/vercel/routes';

buildVercelOutput({
  appName: 'TanStack Start (Console)',
  clientCandidates: ['dist/client'],
  serverCandidates: ['dist/server'],
  outputConfig: {
    version: 3,
    routes: [
      securityHeaderRoute({
        contentSecurityPolicy: buildFrontendContentSecurityPolicy('console', {
          environment: 'production',
        }),
      }),
      ...staticAssetRoutes(),
      iconCacheRoute(true),
      authLogoutRedirect(),
      ...buildOutputConsoleApiRoutes(),
      filesystemRoute(),
      serverlessFallbackRoute(),
    ],
  },
  functionHandler: 'server.js',
}).catch(handleBuildFailure);
