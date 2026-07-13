import { describe, expect, it, vi } from 'bun:test';
import type { AnyRoute } from '@tanstack/react-router';

const createRouter = vi.fn((options: unknown) => ({ options }));
const routeTree = { id: 'console-route-tree' } as unknown as AnyRoute;

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(),
  createRouter,
}));

vi.mock('./routeTree.gen', () => ({
  routeTree,
}));

const { getRouter } = await import('./router');

describe('console router', () => {
  it('creates a router with scroll restoration enabled', () => {
    expect(getRouter() as unknown).toEqual({
      options: {
        routeTree,
        scrollRestoration: true,
      },
    });
    expect(createRouter).toHaveBeenCalledWith({
      routeTree,
      scrollRestoration: true,
    });
  });
});
