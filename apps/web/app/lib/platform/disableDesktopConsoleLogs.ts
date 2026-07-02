'use client';

import { initializeDesktopRuntime } from '@taskforceai/shared/utils/runtime';
import { logger } from '../logger';

export const disableDesktopConsoleLogs = (): void => {
  initializeDesktopRuntime(() => {
    // Accessing the logger ensures the module executes on mount, which installs console bridges.
    void logger;
  });
};
