import '@testing-library/jest-dom';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import type React from 'react';

import '../../../../tests/setup/dom';

const usePlanCheckout = vi.fn();
const appShellProps: unknown[] = [];

vi.mock('../lib/hooks/usePlanCheckout', () => ({
  usePlanCheckout,
}));

vi.mock('./AppShell', () => ({
  AppShell: (props: Record<string, unknown>) => {
    appShellProps.push(props);
    return <main data-testid="app-shell">App shell</main>;
  },
}));

vi.mock('./ProductShellProviders', () => ({
  ProductShellProviders: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="product-shell-providers">{children}</div>
  ),
}));

const { default: App } = await import('./App');

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    appShellProps.length = 0;
  });

  it('runs plan checkout handling and renders the app shell inside product providers', () => {
    const props = {
      initialConversationId: 'conv-1',
      initialMessages: [],
    } as any;

    render(<App {...props} />);

    expect(usePlanCheckout).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('product-shell-providers')).toContainElement(
      screen.getByTestId('app-shell')
    );
    expect(appShellProps).toEqual([props]);
  });
});
