import { render } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import '../../../tests/setup/dom';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

describe('Dialog', () => {
  it('has the correct z-index for overlay and content (Hardening TF-0243)', () => {
    const { getByRole } = render(
      <Dialog open={true}>
        <DialogContent>
          <DialogTitle>Test dialog</DialogTitle>
          <DialogDescription>Verifies dialog overlay and content stacking.</DialogDescription>
          Test Content
        </DialogContent>
      </Dialog>
    );

    // Radix Dialog renders in a Portal
    const content = getByRole('dialog');
    expect(content.style.zIndex).toBe('999999');

    // Find the overlay by its class name
    const overlay = document.querySelector('.radix-dialog-overlay');
    expect(overlay).not.toBeNull();
    const overlayElement = overlay as HTMLElement;
    expect(overlayElement.style.zIndex).toBe('999998');
  });
});
