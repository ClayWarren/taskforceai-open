#!/usr/bin/env bun
import {
  buildVercelOutput,
  filesystemRoute,
  handleBuildFailure,
  iconCacheRoute,
  route,
  securityHeaderRoute,
  serverlessFallbackRoute,
  staticAssetRoutes,
  temporaryRedirectRoute,
} from '../../../scripts/vercel/build-output';

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
      temporaryRedirectRoute('/auth/logout', 'https://auth.taskforceai.chat/api/v1/auth/logout'),
      route('/api/auth/(.*)', 'https://auth.taskforceai.chat/api/auth/$1'),
      route('/api/v1/auth/(.*)', 'https://auth.taskforceai.chat/api/v1/auth/$1'),
      route('/api/v1/developer/(.*)', 'https://developer.taskforceai.chat/api/v1/developer/$1'),
      route('/api/v1/payments/(.*)', 'https://billing.taskforceai.chat/api/v1/payments/$1'),
      route('/api/v1/checkout/(.*)', 'https://billing.taskforceai.chat/api/v1/checkout/$1'),
      route('/api/v1/(.*)', 'https://api.taskforceai.chat/api/v1/$1'),
      route('/api/(.*)', 'https://api.taskforceai.chat/api/$1'),
      filesystemRoute(),
      serverlessFallbackRoute(),
    ],
  },
  functionHandler: 'server.js',
}).catch(handleBuildFailure);
