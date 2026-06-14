import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';

/**
 * Creates a standard SSR handler for TanStack Start applications.
 * @param createRouter Function that returns the application router instance.
 */
export function createStandardSSRHandler(createRouter: any) {
  // TanStack Start runtime accepts object config, but types expect callback function
  const handlerOptions = {
    createRouter,
    defaultStreamHandler,
  };

  return createStartHandler(handlerOptions as any);
}
