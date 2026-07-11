import { afterEach, describe, expect, it, vi } from 'bun:test';

let requestHandler: ((context: { next: () => Promise<unknown> }) => Promise<Response>) | undefined;
const csrfMiddleware = { kind: 'csrf' };
const createStart = vi.fn((factory: () => unknown) => factory());
const createCsrfMiddleware = vi.fn(
  (_options: { filter: (context: { handlerType: string }) => boolean }) => csrfMiddleware
);
const createMiddleware = vi.fn(() => ({
  server: (handler: typeof requestHandler) => {
    requestHandler = handler;
    return handler;
  },
}));

void vi.mock('@tanstack/react-start', () => ({
  createCsrfMiddleware,
  createMiddleware,
  createStart,
}));

import { createFrontendStart } from './start';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe('createFrontendStart', () => {
  it('injects app security headers and CSRF protection', async () => {
    process.env.NODE_ENV = 'production';
    const getSecurityHeaders = vi.fn(() => ({ 'X-App-Policy': 'enabled' }));

    const result = createFrontendStart(getSecurityHeaders) as unknown as {
      requestMiddleware: unknown[];
    };
    const response = await requestHandler?.({
      next: async () => ({
        response: new Response('ok', {
          status: 201,
          statusText: 'Created',
          headers: { 'X-Existing': 'preserved' },
        }),
      }),
    });

    expect(getSecurityHeaders).toHaveBeenCalledWith('production');
    expect(result.requestMiddleware).toEqual([requestHandler, csrfMiddleware]);
    expect(response?.status).toBe(201);
    expect(response?.headers.get('X-Existing')).toBe('preserved');
    expect(response?.headers.get('X-App-Policy')).toBe('enabled');
    const csrfOptions = createCsrfMiddleware.mock.calls[0]?.[0];
    expect(csrfOptions?.filter({ handlerType: 'serverFn' })).toBe(true);
    expect(csrfOptions?.filter({ handlerType: 'request' })).toBe(false);
  });
});
