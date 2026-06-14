'use client';

import React, { Suspense, lazy } from 'react';

import type { AppShellProps as AppProps } from './App';

// Use React.lazy instead of next/dynamic for code splitting
const ClientApp = lazy(() => import('./App'));

const AppClient: React.FC<AppProps> = (props) => (
  <Suspense fallback={null}>
    <ClientApp {...props} />
  </Suspense>
);

export default AppClient;
