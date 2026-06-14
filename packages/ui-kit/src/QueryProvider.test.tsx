import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

import { QueryProvider, createAppQueryClient } from './QueryProvider';

function QueryClientConsumer() {
  const queryClient = useQueryClient();
  return <span>{String(queryClient.getDefaultOptions().queries?.staleTime)}</span>;
}

describe('QueryProvider', () => {
  it('creates query clients with caller-provided query defaults', () => {
    const queryClient = createAppQueryClient({ retry: false, staleTime: 30_000 });

    expect(queryClient.getDefaultOptions().queries).toMatchObject({
      retry: false,
      staleTime: 30_000,
    });
  });

  it('provides a stable query client to children', () => {
    render(
      <QueryProvider queryDefaults={{ staleTime: 60_000 }}>
        <QueryClientConsumer />
      </QueryProvider>
    );

    expect(screen.getByText('60000')).toBeInTheDocument();
  });

  it('clears the query client on unmount when requested', () => {
    const clear = vi.spyOn(QueryClient.prototype, 'clear');
    const { unmount } = render(
      <QueryProvider clearOnUnmount>
        <span>child</span>
      </QueryProvider>
    );

    unmount();

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('does not clear the query client on unmount by default', () => {
    const clear = vi.spyOn(QueryClient.prototype, 'clear');
    const { unmount } = render(
      <QueryProvider>
        <span>child</span>
      </QueryProvider>
    );
    clear.mockClear();

    unmount();

    expect(clear).not.toHaveBeenCalled();
  });
});
