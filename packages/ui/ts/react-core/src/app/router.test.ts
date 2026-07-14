import { describe, expect, it, vi } from 'bun:test';
import type { AnyRoute } from '@tanstack/react-router';

const createRouter = vi.fn((options: unknown) => options);

void vi.mock('@tanstack/react-router', () => ({ createRouter }));

import { createStandardRouter } from './router';

describe('createStandardRouter', () => {
  it('enables scroll restoration with optional intent preloading', () => {
    const routeTree = { id: 'root' };

    expect(createStandardRouter(routeTree as AnyRoute) as unknown).toEqual({
      routeTree,
      scrollRestoration: true,
    });
    expect(createStandardRouter(routeTree as AnyRoute, 'intent') as unknown).toEqual({
      routeTree,
      scrollRestoration: true,
      defaultPreload: 'intent',
    });
  });
});
