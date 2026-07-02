import '@testing-library/jest-dom';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import type React from 'react';

import '../../../../../tests/setup/dom';

vi.mock('@taskforceai/ui-kit/QueryProvider', () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="query-provider">{children}</div>
  ),
}));

vi.mock('../../components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-provider">{children}</div>
  ),
}));

vi.mock('./AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-provider">{children}</div>
  ),
}));

const { Providers } = await import('./RootProviders');

describe('console RootProviders', () => {
  afterEach(() => {
    cleanup();
  });

  it('wraps console children with query, auth, and tooltip providers', () => {
    render(
      <Providers>
        <main>Console content</main>
      </Providers>
    );

    expect(screen.getByTestId('query-provider')).toContainElement(
      screen.getByTestId('auth-provider')
    );
    expect(screen.getByTestId('auth-provider')).toContainElement(
      screen.getByTestId('tooltip-provider')
    );
    expect(screen.getByTestId('tooltip-provider')).toContainElement(
      screen.getByText('Console content')
    );
  });
});
