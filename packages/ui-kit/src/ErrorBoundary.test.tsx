import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ReactNode } from 'react';
import '../../../tests/setup/dom';

const mockLoggerError = vi.fn();
const mockReloadPage = vi.fn();

vi.mock('@taskforceai/contracts/auth/logger', () => ({
  getAuthLogger: () => ({ error: mockLoggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@taskforceai/shared/utils/browser-actions', () => ({
  reloadPage: () => mockReloadPage(),
}));

import { ErrorBoundary } from './ErrorBoundary';

function ThrowingChild(): ReactNode {
  throw new Error('render failed');
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    mockReloadPage.mockReturnValue({ ok: true, value: undefined });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children while there is no error', () => {
    render(
      <ErrorBoundary>
        <span>healthy</span>
      </ErrorBoundary>
    );

    expect(screen.getByText('healthy')).toBeInTheDocument();
  });

  it('renders the default fallback for caught errors', () => {
    const view = render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );

    const rendered = within(view.container);
    expect(rendered.getByText('Something went wrong')).toBeInTheDocument();
    expect(rendered.getByText('render failed')).toBeInTheDocument();
    expect(rendered.getByRole('button', { name: 'Reload Page' })).toHaveAttribute('type', 'button');
  });

  it('renders a custom fallback when provided', () => {
    const view = render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingChild />
      </ErrorBoundary>
    );

    const rendered = within(view.container);
    expect(rendered.getByText('Custom fallback')).toBeInTheDocument();
    expect(rendered.queryByText('Something went wrong')).toBeNull();
  });

  it('reloads the page from the default fallback action', () => {
    const view = render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );

    fireEvent.click(within(view.container).getByRole('button', { name: 'Reload Page' }));

    expect(mockReloadPage).toHaveBeenCalled();
  });

  it('keeps the fallback usable when reload fails', () => {
    mockReloadPage.mockReturnValue({ ok: false, error: { kind: 'failed' } });

    const view = render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );
    fireEvent.click(within(view.container).getByRole('button', { name: 'Reload Page' }));

    expect(mockReloadPage).toHaveBeenCalled();
  });
});
