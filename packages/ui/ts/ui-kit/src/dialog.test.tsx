import { render } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import '../../../../../tests/setup/dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

describe('Dialog', () => {
  it('uses the shared overlay z-index scale for overlay and content', () => {
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
    expect(content).toHaveClass('z-50');
    expect(content.style.zIndex).toBe('');

    // Find the overlay by its class name
    const overlay = document.querySelector('.radix-dialog-overlay');
    expect(overlay).not.toBeNull();
    const overlayElement = overlay as HTMLElement;
    expect(overlayElement).toHaveClass('z-50');
    expect(overlayElement.style.zIndex).toBe('');
  });

  it('renders dialog header and footer layout helpers', () => {
    const { getByText } = render(
      <DialogHeader className="custom-header">
        <span>Header title</span>
        <DialogFooter className="custom-footer">Footer actions</DialogFooter>
      </DialogHeader>
    );

    expect(getByText('Header title').parentElement).toHaveClass('custom-header');
    expect(getByText('Footer actions')).toHaveClass('custom-footer');
  });
});
