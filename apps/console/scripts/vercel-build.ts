#!/usr/bin/env bun
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
      securityHeaderRoute(),
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
