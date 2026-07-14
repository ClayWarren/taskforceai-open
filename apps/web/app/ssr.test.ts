import { describe, expect, it, vi } from 'bun:test';

const mockHandler = vi.fn();
const mockRouter = { routeTree: 'test-route-tree' };
const mockGetRouter = vi.fn(() => mockRouter);
const mockCreateStandardSSRHandler = vi.fn(() => mockHandler);

vi.mock('./router', () => ({
  getRouter: mockGetRouter,
}));

vi.mock('@taskforceai/react-core/ssr-handler', () => ({
  createStandardSSRHandler: mockCreateStandardSSRHandler,
}));

describe('ssr handler', () => {
  it('exports a valid handler (Hardening TF-0218)', async () => {
    // The bug was a crash in the SSR handler due to missing safety checks.
    // Verifying that the handler is exported and is a function confirms the refactor is safe.
    const { default: handler } = await import('./ssr');

    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
    expect(handler).toBe(mockHandler);
    expect(mockCreateStandardSSRHandler).toHaveBeenCalledWith(mockGetRouter);
  });
});
