import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterEach, vi } from 'bun:test';

try {
  GlobalRegistrator.register();
} catch {
  // Already registered
}

afterEach(() => {
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML = '';
  }
  vi.restoreAllMocks();
});
