import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import '../../../../../../tests/setup/dom';
import { KeyboardShortcutsSection } from './ProfileKeyboardSection';

const commandButton = (label: string): HTMLButtonElement => {
  const row = screen.getByText(label).parentElement?.parentElement;
  const button = row?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing shortcut for ${label}`);
  return button;
};

describe('KeyboardShortcutsSection', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => cleanup());

  it('records unique bindings, rejects conflicts, cancels, and resets', () => {
    render(<KeyboardShortcutsSection />);

    const palette = commandButton('Open command palette');
    fireEvent.click(palette);
    fireEvent.keyDown(palette, { key: 'Shift', shiftKey: true });
    expect(palette.textContent).toContain('Press shortcut');
    fireEvent.keyDown(palette, { key: 'Escape' });
    expect(palette.textContent).not.toContain('Press shortcut');

    fireEvent.click(palette);
    fireEvent.keyDown(palette, { key: 'n', ctrlKey: true });
    expect(screen.getByText(/already assigned to New task/)).toBeTruthy();

    fireEvent.click(palette);
    fireEvent.keyDown(palette, { key: '9', ctrlKey: true, shiftKey: true });
    expect(palette.textContent).toContain('9');
    expect(screen.queryByText(/already assigned/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(palette.textContent).toContain('P');
  });
});
