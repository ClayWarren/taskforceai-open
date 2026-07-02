import { registerRootComponent } from 'expo';
import { ExpoRoot } from 'expo-router';
import React from 'react';

import { mobileLogger } from './src/logger';
import { initMobileSentry } from './src/observability/sentry';

initMobileSentry();

function App() {
  const context = require.context('./app');
  return React.createElement(ExpoRoot, { context });
}

registerRootComponent(App);

if (process.env.NODE_ENV !== 'production') {
  mobileLogger.debug('Expo Router entry loaded for TaskForceAI mobile');
}
