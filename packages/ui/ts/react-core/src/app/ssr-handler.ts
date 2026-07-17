import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';

type CreateRouter = () => unknown;

/**
 * Creates a standard SSR handler for TanStack Start applications.
 * @param createRouter Function that returns the application router instance.
 */
export function createStandardSSRHandler(createRouter: CreateRouter) {
  // TanStack Start runtime accepts object config, but types expect callback function
  const handlerOptions = {
    createRouter,
    defaultStreamHandler,
  };

  return createStartHandler(handlerOptions as unknown as Parameters<typeof createStartHandler>[0]);
}
