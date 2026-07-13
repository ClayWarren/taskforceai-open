import { describe, expect, it, vi } from 'bun:test';

const createStartHandler = vi.fn((options: unknown) => ({
  handler: 'start',
  options,
}));
const defaultStreamHandler = vi.fn();

void vi.mock('@tanstack/react-start/server', () => ({
  createStartHandler,
  defaultStreamHandler,
}));

import { createStandardSSRHandler } from './ssr-handler';

describe('createStandardSSRHandler', () => {
  it('delegates to TanStack Start with the shared stream handler', () => {
    const createRouter = vi.fn();

    const handler = createStandardSSRHandler(createRouter);

    expect(handler as unknown).toEqual({
      handler: 'start',
      options: {
        createRouter,
        defaultStreamHandler,
      },
    });
    expect(createStartHandler).toHaveBeenCalledWith({
      createRouter,
      defaultStreamHandler,
    });
  });
});
