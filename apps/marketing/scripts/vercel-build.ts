#!/usr/bin/env bun
import {
  buildVercelOutput,
  filesystemRoute,
  handleBuildFailure,
  iconCacheRoute,
  iconResponseHeader,
  permanentRedirectRoute,
  reactFunctionPackageJSON,
  securityHeaderRoute,
  serverlessFallbackRoute,
  staticAssetRoutes,
} from '../../../scripts/vercel/build-output';

buildVercelOutput({
  appName: 'TanStack Start Marketing',
  clientCandidates: ['dist/client', '.output/public'],
  serverCandidates: ['.output/server', 'dist/server'],
  outputConfig: {
    version: 3,
    headers: [iconResponseHeader()],
    routes: [
      securityHeaderRoute(),
      ...staticAssetRoutes(),
      iconCacheRoute(),
      permanentRedirectRoute('/', '/home'),
      filesystemRoute(),
      serverlessFallbackRoute(),
    ],
  },
  functionPackageJSON: reactFunctionPackageJSON(),
}).catch(handleBuildFailure);
