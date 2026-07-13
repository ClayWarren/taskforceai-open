import { createStandardRouter } from '@taskforceai/react-core/router';

import { routeTree } from './routeTree.gen';

export const getRouter = () => createStandardRouter(routeTree);

// Register the router for type-safety
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
