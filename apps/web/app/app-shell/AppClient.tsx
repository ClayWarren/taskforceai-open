'use client';

import React from 'react';

import App, { type AppShellProps as AppProps } from './App';

const AppClient: React.FC<AppProps> = (props) => <App {...props} />;

export default AppClient;
