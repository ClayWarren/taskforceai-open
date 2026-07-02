import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { confirmDialog } from './confirm-dialog';

describe('confirmDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders correctly with default options', async () => {
    confirmDialog('Are you sure?');

    // Check if modal is in DOM
    const modal = document.body.lastChild;
    if (!(modal instanceof HTMLElement)) {
      throw new Error('Expected modal element');
    }
    expect(modal).toBeDefined();
    expect(document.body.textContent).toContain('Are you sure?');
    expect(document.body.textContent).toContain('Confirm');
    expect(document.body.textContent).toContain('Cancel');
  });

  it('resolves true on confirm button click', async () => {
    const promise = confirmDialog('Confirm this?');
    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Confirm'
    );

    confirmButton?.click();
    const result = await promise;
    expect(result).toBe(true);
    expect(document.body.innerHTML).toBe('');
  });

  it('resolves false on cancel button click', async () => {
    const promise = confirmDialog('Cancel this?');
    const cancelButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancel'
    );

    cancelButton?.click();
    const result = await promise;
    expect(result).toBe(false);
    expect(document.body.innerHTML).toBe('');
  });

  it('resolves false on Escape key', async () => {
    const promise = confirmDialog('Escape this?');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    const result = await promise;
    expect(result).toBe(false);
    expect(document.body.innerHTML).toBe('');
  });

  it('ignores non-Escape keys', async () => {
    const promise = confirmDialog('Ignore this key?');

    // Press a non-Escape key - should not close the dialog
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    // Dialog should still be open
    expect(document.body.innerHTML).not.toBe('');

    // Now close it properly
    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Confirm'
    );
    confirmButton?.click();

    const result = await promise;
    expect(result).toBe(true);
  });

  it('uses custom title and warning kind', async () => {
    confirmDialog('Delete something?', { title: 'Delete Title', kind: 'warning' });

    expect(document.body.textContent).toContain('Delete Title');
    expect(document.body.textContent).toContain('Delete');
  });

  it('uses custom title without warning kind', async () => {
    confirmDialog('Continue?', { title: 'Custom Title' });

    expect(document.body.textContent).toContain('Custom Title');
    expect(document.body.textContent).toContain('Confirm'); // Not 'Delete'
  });

  it('prevents multiple resolutions', async () => {
    const promise = confirmDialog('Once only?');
    const buttons = document.querySelectorAll('button');

    const cancelButton = buttons.item(0);
    const confirmButton = buttons.item(1);
    cancelButton?.click(); // Cancel
    confirmButton?.click(); // Confirm (should be ignored)

    const result = await promise;
    expect(result).toBe(false);
  });

  it('resolves false when clicking the backdrop', async () => {
    const promise = confirmDialog('Backdrop click?');
    const modal = document.body.lastChild;
    if (!(modal instanceof HTMLElement)) {
      throw new Error('Expected modal element');
    }

    modal.click();

    const result = await promise;
    expect(result).toBe(false);
    expect(document.body.innerHTML).toBe('');
  });

  it('cycles focus forward with Tab', async () => {
    confirmDialog('Tab forward?');
    const buttons = Array.from(document.querySelectorAll('button'));
    const cancelButton = buttons[0];
    const confirmButton = buttons[1];
    if (
      !(cancelButton instanceof HTMLButtonElement) ||
      !(confirmButton instanceof HTMLButtonElement)
    ) {
      throw new Error('Expected dialog buttons');
    }

    cancelButton.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(confirmButton);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(cancelButton);
  });

  it('cycles focus backward with Shift+Tab', async () => {
    confirmDialog('Shift tab?');
    const buttons = Array.from(document.querySelectorAll('button'));
    const cancelButton = buttons[0];
    const confirmButton = buttons[1];
    if (
      !(cancelButton instanceof HTMLButtonElement) ||
      !(confirmButton instanceof HTMLButtonElement)
    ) {
      throw new Error('Expected dialog buttons');
    }

    confirmButton.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
    );
    expect(document.activeElement).toBe(cancelButton);
  });

  it('focuses the confirm button after mount', async () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });

    confirmDialog('Focus confirm?');
    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Confirm'
    );
    expect(confirmButton).toBeDefined();
    expect(document.activeElement).toBe(confirmButton!);

    rafSpy.mockRestore();
  });

  it('handles modal already removed from DOM', async () => {
    const promise = confirmDialog('Remove early?');
    const modal = document.body.lastChild;
    if (!(modal instanceof HTMLElement)) {
      throw new Error('Expected modal element');
    }

    // Manually remove modal before clicking
    document.body.removeChild(modal);

    // Click confirm button (which is now detached)
    const confirmButton = modal.querySelector('button:last-child');
    if (confirmButton instanceof HTMLButtonElement) {
      confirmButton.click();
    }

    const result = await promise;
    expect(result).toBe(true);
  });
});
