import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const routeTreeMock = { id: '__root__' };
const createRouterMock = vi.fn((options: { routeTree: unknown; scrollRestoration: boolean }) => ({
  options,
}));

mock.restore();

mock.module('./routeTree.gen', () => ({
  routeTree: routeTreeMock,
}));

const reactRouter = await import('@tanstack/react-router');

mock.module('@tanstack/react-router', () => ({
  ...reactRouter,
  createRouter: createRouterMock,
}));

let getRouter: typeof import('./router').getRouter;

beforeAll(async () => {
  ({ getRouter } = await import('./router'));
});

afterAll(() => {
  mock.restore();
});

describe('router', () => {
  beforeEach(() => {
    createRouterMock.mockClear();
  });

  it('configures TanStack router with routeTree and scroll restoration', () => {
    const router = getRouter();

    expect(createRouterMock).toHaveBeenCalledWith({
      routeTree: routeTreeMock,
      scrollRestoration: true,
    });
    expect(router.options.scrollRestoration).toBe(true);
    expect(router.options.routeTree).toBeDefined();
  });
});
