import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const loggerErrorMock = vi.fn();
const loggerWarnMock = vi.fn();

mock.module('../../lib/logger', () => ({
  logger: {
    error: loggerErrorMock,
    warn: loggerWarnMock,
  },
}));

const { StatusErrorBoundary } = await import('./StatusErrorBoundary');

function ThrowOnce() {
  if (loggerErrorMock.mock.calls.length === 0) {
    throw new Error('render failed');
  }

  return <p>Recovered status page</p>;
}

describe('StatusErrorBoundary', () => {
  it('logs render failures, shows fallback UI, and retries children', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <StatusErrorBoundary>
        <ThrowOnce />
      </StatusErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText('The status page encountered an unexpected error.')
    ).toBeInTheDocument();
    expect(loggerErrorMock).toHaveBeenCalledWith('StatusPage render error', {
      message: 'render failed',
      stack: expect.any(String),
      componentStack: expect.any(String),
    });

    const retryButton = screen.getByRole('button', { name: 'Try again' });
    expect(retryButton).toHaveAttribute('type', 'button');
    fireEvent.click(retryButton);

    expect(screen.getByText('Recovered status page')).toBeInTheDocument();
  });
});
