import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';
import { DesktopUpdateButton } from './DesktopUpdateButton';

describe('DesktopUpdateButton', () => {
  it('checks for updates from the idle empty state', () => {
    const onCheckForUpdates = vi.fn();
    render(
      <DesktopUpdateButton
        desktopUpdateVersion=""
        desktopUpdateAction="idle"
        onCheckForUpdates={onCheckForUpdates}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Install TaskForceAI' }));
    expect(screen.getByText('Check updates')).toBeInTheDocument();
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['idle', 'Update 1.2.3', false, 'Install TaskForceAI 1.2.3'],
    ['checking', 'Checking...', true, 'Install TaskForceAI 1.2.3'],
    ['installing', 'Installing...', true, 'Installing TaskForceAI 1.2.3'],
  ] as const)('renders the %s update state', (action, label, busy, accessibleName) => {
    render(
      <DesktopUpdateButton
        desktopUpdateVersion="1.2.3"
        desktopUpdateAction={action}
        onCheckForUpdates={vi.fn()}
      />
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: accessibleName });
    expect(button).toHaveProperty('disabled', busy);
    expect(button.getAttribute('aria-busy')).toBe(busy ? 'true' : null);
  });
});
