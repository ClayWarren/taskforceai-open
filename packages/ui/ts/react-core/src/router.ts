import { createRouter, type AnyRoute } from '@tanstack/react-router';

export function createStandardRouter<TRouteTree extends AnyRoute>(
  routeTree: TRouteTree,
  defaultPreload?: 'intent'
) {
  const options = {
    routeTree,
    scrollRestoration: true,
    ...(defaultPreload ? { defaultPreload } : {}),
  };

  // Each generated route tree has no required router context, but that cannot be
  // proven for an unconstrained generic until the concrete app calls this helper.
  return createRouter<TRouteTree>(options as never);
}
