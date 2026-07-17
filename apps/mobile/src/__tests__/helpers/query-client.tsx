import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import TestRenderer from 'react-test-renderer';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function renderWithQueryClient(
  ui: React.ReactElement,
  queryClient: QueryClient = createTestQueryClient()
): { renderer: TestRenderer.ReactTestRenderer; queryClient: QueryClient } {
  const renderer = TestRenderer.create(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
  return { renderer, queryClient };
}

export function createHookWrapper(queryClient: QueryClient = createTestQueryClient()) {
  return function QueryClientWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

export async function renderHookWithQueryClient<T>(useHook: () => T) {
  const queryClient = createTestQueryClient();
  const rendered = await renderHook(useHook, { wrapper: createHookWrapper(queryClient) });
  return Object.assign(rendered, { queryClient });
}
