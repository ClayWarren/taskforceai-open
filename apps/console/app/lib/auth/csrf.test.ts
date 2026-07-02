import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import * as csrf from './csrf';

describe('csrf', () => {
  const originalFetch = global.fetch;
  const originalDocument = global.document;
  let cookieValue = '';

  const setCookie = (value: string) => {
    cookieValue = value;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn() as any;
    cookieValue = '';
    Object.defineProperty(globalThis, 'document', {
      value: {
        get cookie() {
          return cookieValue;
        },
        set cookie(value: string) {
          cookieValue = value;
        },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    if (typeof originalDocument === 'undefined') {
      // @ts-expect-error - deleting test-injected document
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
    vi.restoreAllMocks();
  });

  describe('getCsrfToken', () => {
    it('fetches a new token when cache is empty', async () => {
      const mockToken = 'new-token';
      (global.fetch as any).mockImplementation(async () => {
        setCookie(`csrf_token=${mockToken}`);
        return {
          ok: true,
          json: async () => ({ csrfToken: mockToken }),
        };
      });

      const token = await csrf.getCsrfToken(true);
      expect(token).toBe(mockToken);
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/csrf', expect.any(Object));
    });

    it('returns empty string if fetch fails', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
      });

      const token = await csrf.getCsrfToken(true);
      expect(token).toBe('');
    });

    it('returns empty string on network error', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const token = await csrf.getCsrfToken(true);
      expect(token).toBe('');
      expect(spy).toHaveBeenCalled();
    });

    it('uses cached token if valid', async () => {
      const mockToken = 'cached-token';
      (global.fetch as any).mockImplementation(async () => {
        setCookie(`csrf_token=${mockToken}`);
        return {
          ok: true,
          json: async () => ({ csrfToken: mockToken }),
        };
      });

      await csrf.getCsrfToken(true); // Populate cache
      (global.fetch as any).mockClear();

      const token = await csrf.getCsrfToken();
      expect(token).toBe(mockToken);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('withCsrf', () => {
    it('does not add header for GET requests', async () => {
      const init = { method: 'GET' };
      const result = await csrf.withCsrf(init);
      expect(result.headers).toBeUndefined();
    });

    it('adds X-CSRF-Token header for POST requests', async () => {
      // Since we can't easily reset the module-level cache, we'll force populate it
      const mockToken = 'post-token';
      (global.fetch as any).mockImplementation(async () => {
        setCookie(`csrf_token=${mockToken}`);
        return {
          ok: true,
          json: async () => ({ csrfToken: mockToken }),
        };
      });

      await csrf.getCsrfToken(true); // Ensure cache is 'post-token'

      const init = { method: 'POST' };
      const result = await csrf.withCsrf(init);
      const headers = result.headers as Headers;
      expect(headers.get('X-CSRF-Token')).toBe(mockToken);
    });

    it('handles requests without method as GET', async () => {
      const init = {};
      const result = await csrf.withCsrf(init);
      expect(result.headers).toBeUndefined();
    });
  });
});
