import { describe, expect, it, vi } from 'bun:test';
import type { AnyRoute } from '@tanstack/react-router';

import {
  createRouterMock,
  getMarketingRouterRedirects,
  resetMarketingRouterMock,
  tanstackRouterMock,
} from './test-utils/router-mock';

const routeTree = { id: 'marketing-route-tree' } as unknown as AnyRoute;

vi.mock('./routeTree.gen', () => ({
  routeTree,
}));

const { getRouter } = await import('./router');

describe('marketing router', () => {
  it('creates a router with scroll restoration and intent preloading', () => {
    expect(getRouter() as unknown).toEqual({
      options: {
        routeTree,
        scrollRestoration: true,
        defaultPreload: 'intent',
      },
    });
    expect(createRouterMock).toHaveBeenCalledWith({
      routeTree,
      scrollRestoration: true,
      defaultPreload: 'intent',
    });
  });

  it('resets redirects and router construction mocks', () => {
    const replacementRouter = { options: { routeTree: 'replacement' } };
    createRouterMock.mockImplementation(() => replacementRouter);
    tanstackRouterMock.redirect({ to: '/home', statusCode: 301 });

    expect(getMarketingRouterRedirects()).toEqual([{ to: '/home', statusCode: 301 }]);
    expect(createRouterMock({ routeTree: 'ignored' })).toBe(replacementRouter);

    resetMarketingRouterMock();

    expect(getMarketingRouterRedirects()).toEqual([]);
    expect(createRouterMock({ routeTree })).toEqual({ options: { routeTree } });
  });
});
