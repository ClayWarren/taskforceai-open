import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterEach, vi } from 'bun:test';

import { resetMarketingRouterMock } from './app/test-utils/router-mock';

try {
  GlobalRegistrator.register();
} catch {
  // Already registered
}

const { cleanup } = await import('@testing-library/react');

if (typeof globalThis !== 'undefined') {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

afterEach(() => {
  cleanup();

  if (typeof document !== 'undefined' && document.body) {
    document.body.removeAttribute('style');
    document.body.removeAttribute('data-scroll-locked');
  }

  vi.restoreAllMocks();
  resetMarketingRouterMock();
});
