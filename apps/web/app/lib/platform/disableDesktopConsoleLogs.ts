'use client';

import { initializeDesktopRuntime } from '@taskforceai/browser-runtime/runtime';
import { logger } from '../logger';

export const disableDesktopConsoleLogs = (): void => {
  initializeDesktopRuntime(() => {
    // Accessing the logger ensures the module executes on mount, which installs console bridges.
    void logger;
  });
};
