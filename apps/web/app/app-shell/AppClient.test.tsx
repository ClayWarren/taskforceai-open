import '@testing-library/jest-dom';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';
import type React from 'react';

import '../../../../tests/setup/dom';

vi.mock('./App', () => ({
  default: ({ initialPrompt }: { initialPrompt?: string }) => (
    <div data-testid="client-app">{initialPrompt}</div>
  ),
}));

const { default: AppClient } = await import('./AppClient');

describe('AppClient', () => {
  it('renders the client app and forwards props', async () => {
    render(
      <AppClient
        {...({ initialPrompt: 'Plan the launch' } as React.ComponentProps<typeof AppClient>)}
      />
    );

    expect(await screen.findByTestId('client-app')).toHaveTextContent('Plan the launch');
  });
});
