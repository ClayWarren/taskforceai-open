'use client';

import { QueryClient, QueryClientProvider, type DefaultOptions } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';

export interface QueryProviderProps {
  children: ReactNode;
  queryDefaults?: DefaultOptions['queries'];
  clearOnUnmount?: boolean;
}

export const createAppQueryClient = (queryDefaults?: DefaultOptions['queries']): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: queryDefaults,
    },
  });

export function QueryProvider({
  children,
  queryDefaults,
  clearOnUnmount = false,
}: QueryProviderProps) {
  // Intentionally create one QueryClient per provider instance. Changing
  // queryDefaults after mount requires remounting this provider.
  const [queryClient] = useState(() => createAppQueryClient(queryDefaults));

  useEffect(() => {
    if (!clearOnUnmount) {
      return;
    }

    return () => {
      queryClient.clear();
    };
  }, [clearOnUnmount, queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
